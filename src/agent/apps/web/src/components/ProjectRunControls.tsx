import { useLingui } from "@lingui/react/macro";
import type { ProjectRunState } from "@rakazo/contracts";
import { Button, NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { Play, Square, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { useReviewWorkspace } from "../lib/review-workspace";

export type ProjectPreparationStatus = { status: string; detail: string };

export function ProjectRunControls({
  botId,
  taskThreadId,
  prepare,
  inspectPreparation,
  cancelPreparation,
}: {
  botId: string;
  taskThreadId?: string;
  prepare(prompt: string, id: string): Promise<string | undefined>;
  inspectPreparation?(runId: string): Promise<ProjectPreparationStatus>;
  cancelPreparation?(runId: string): Promise<unknown>;
}) {
  const { t } = useLingui();
  const bridge = desktopBridge();
  const runner = bridge?.projectRunner;
  const review = useReviewWorkspace();
  const [state, setState] = useState<ProjectRunState | null>(null);
  const [profile, setProfile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const [preparationDetail, setPreparationDetail] = useState("");
  const current = useRef(true),
    intent = useRef(false),
    pending = useRef(false);
  const submitting = useRef(false);
  const retryingStatus = useRef(false);
  const submitted = useRef(new Set<string>()),
    opened = useRef("");
  const preparationRun = useRef<string | undefined>(undefined);
  const preparationEnded = useRef(false);
  const latest = useRef({
    profile,
    review,
    inspectPreparation,
    failure: t`Could not run the project.`,
    missing: t`Configuration was not prepared. Open the details to see the result.`,
  });
  latest.current = {
    profile,
    review,
    inspectPreparation,
    failure: t`Could not run the project.`,
    missing: t`Configuration was not prepared. Open the details to see the result.`,
  };
  const receive = (next: ProjectRunState) => {
    if (!current.current) return;
    setState(next);
    if (next.phase === "running" && next.urls.length) {
      const url = next.urls[0]!;
      const key = JSON.stringify([next.profile, url.url]);
      if (opened.current !== key) {
        opened.current = key;
        latest.current.review?.add({
          id: `run:${botId}`,
          name: next.project ?? url.name,
          mimeType: "text/uri-list",
          url: url.url,
        });
      }
    }
  };
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  useEffect(() => {
    current.current = true;
    if (!runner) return;
    const poll = async () => {
      if (pending.current || submitting.current) return;
      pending.current = true;
      try {
        let next = await runner.state(botId);
        if (!current.current) return;
        if (
          preparationRun.current &&
          !preparationEnded.current &&
          latest.current.inspectPreparation
        ) {
          const result = await latest.current.inspectPreparation(preparationRun.current);
          if (!current.current) return;
          setPreparationDetail(result.detail);
          preparationEnded.current = ["completed", "failed", "cancelled"].includes(result.status);
          // The task may have written its binding while the status request was in flight.
          if (preparationEnded.current) next = await runner.state(botId);
        }
        if (retryingStatus.current) {
          retryingStatus.current = false;
          setError("");
        }
        receiveRef.current(next);
        if (
          next.phase === "preparing" &&
          intent.current &&
          preparationRun.current &&
          preparationEnded.current
        ) {
          intent.current = false;
          receiveRef.current(await runner.stop(botId));
          if (current.current) setError(latest.current.missing);
          return;
        }
        if (
          next.phase === "configured" &&
          next.preparation &&
          intent.current &&
          submitted.current.has(next.preparation.id)
        ) {
          intent.current = false;
          const started = await runner.play({
            botId,
            profile: latest.current.profile || undefined,
            preparationId: next.preparation.id,
          });
          receiveRef.current(started);
        }
      } catch (cause) {
        if (current.current && intent.current && !submitting.current) {
          setError(cause instanceof Error ? cause.message : latest.current.failure);
          // A failed observation must not consume Play; native admission is checked
          // again before starting. Account/access refusals still cancel the intent.
          retryingStatus.current =
            /TimeoutError|timed? out|timeout|fetch failed|NetworkError|Failed to fetch|ECONNRESET|ECONNREFUSED/i.test(
              cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
            );
          if (!retryingStatus.current) intent.current = false;
        }
      } finally {
        pending.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      current.current = false;
      intent.current = false;
      clearInterval(timer);
    };
  }, [botId, runner]);
  if (!runner || !bridge?.computer || !review) return null;
  const active = state?.phase === "starting" || state?.phase === "running";
  const preparing =
    state?.phase === "preparing" && intent.current && (!error || retryingStatus.current);
  const auxiliaryActive = Boolean(preparationRun.current && !preparationEnded.current);
  async function play() {
    submitting.current = true;
    retryingStatus.current = false;
    setBusy(true);
    setError("");
    intent.current = true;
    opened.current = "";
    preparationRun.current = undefined;
    preparationEnded.current = false;
    setPreparationDetail("");
    try {
      if (!(await bridge!.computer!.requestAccess())) {
        intent.current = false;
        return;
      }
      if (!current.current) return;
      await bridge!.computer!.connect!(botId);
      if (!current.current || !intent.current) return;
      if (taskThreadId) {
        if (!bridge!.computer!.prepareTask) throw new Error(t`Update Desktop before running this project.`);
        await bridge!.computer!.prepareTask({ botId, taskThreadId });
      }
      if (!current.current || !intent.current) return;
      const next = await runner!.play({ botId, profile: profile || undefined });
      if (!current.current || !intent.current) return;
      receive(next);
      if (next.preparation && !submitted.current.has(next.preparation.id)) {
        preparationRun.current = await prepare(next.preparation.prompt, next.preparation.id);
        if (current.current) submitted.current.add(next.preparation.id);
      }
    } catch (cause) {
      if (current.current)
        setError(cause instanceof Error ? cause.message : t`Could not run the project.`);
    } finally {
      submitting.current = false;
      if (current.current) setBusy(false);
    }
  }
  async function stop() {
    intent.current = false;
    retryingStatus.current = false;
    opened.current = "";
    setBusy(true);
    setError("");
    try {
      try {
        receive(await runner!.stop(botId));
      } finally {
        if (preparationRun.current && !preparationEnded.current) {
          await cancelPreparation?.(preparationRun.current);
          preparationEnded.current = true;
        }
      }
    } catch (cause) {
      if (current.current)
        setError(cause instanceof Error ? cause.message : t`Could not stop the project.`);
    } finally {
      if (current.current) setBusy(false);
    }
  }
  return (
    <div className="min-w-0 shrink-0 border-b border-border px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label={t`Run project`}
          disabled={busy || active || preparing || auxiliaryActive}
          onClick={() => void play()}
        >
          <Play size={14} />
          {preparing ? t`Preparing…` : state?.phase === "starting" ? t`Starting…` : t`Run`}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t`Stop project`}
          disabled={busy || (!active && state?.phase !== "preparing" && !auxiliaryActive)}
          onClick={() => void stop()}
        >
          <Square size={14} />
        </Button>
        {(state?.profiles.length ?? 0) > 1 && (
          <NativeSelect
            size="sm"
            className="min-w-0 max-w-full"
            aria-label={t`Run profile`}
            value={profile || state?.profile || state?.profiles[0]?.id || ""}
            disabled={busy || active || preparing}
            onChange={(event) => setProfile(event.target.value)}
          >
            {state!.profiles.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        <span role="status" className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {preparing
            ? t`Preparing configuration`
            : active
              ? `${state!.services.filter((service) => service.phase === "running").length}/${state!.services.length}`
              : (state?.project ?? "")}
        </span>
        <Button
          className="ml-auto"
          variant="ghost"
          size="icon-sm"
          aria-label={t`Service logs`}
          aria-expanded={details}
          onClick={() => setDetails((value) => !value)}
        >
          <Terminal size={15} />
        </Button>
      </div>
      {(error || state?.error) && (
        <p role="alert" className="mt-2 break-words text-sm text-destructive">
          {error || state?.error}
        </p>
      )}
      {details && (
        <div className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
          {preparationDetail && (
            <p className="mb-2 whitespace-pre-wrap break-words">{preparationDetail}</p>
          )}
          {state?.services.map((service) => (
            <div key={service.id} className="flex justify-between gap-3">
              <span>{service.id}</span>
              <span>
                {service.phase === "running"
                  ? t`Running`
                  : service.phase === "starting"
                    ? t`Starting…`
                    : service.phase === "waiting"
                      ? t`Waiting`
                      : t`Stopped`}
              </span>
            </div>
          ))}
          {state?.urls.map((item) => (
            <Button
              key={item.url}
              variant="ghost"
              size="sm"
              onClick={() =>
                review.add({
                  id: `run:${botId}:${item.name}`,
                  name: item.name,
                  mimeType: "text/uri-list",
                  url: item.url,
                })
              }
            >
              {item.name}
            </Button>
          ))}
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {state?.logs || t`No service output yet.`}
          </pre>
        </div>
      )}
    </div>
  );
}
