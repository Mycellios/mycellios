import { useLingui } from "@lingui/react/macro";
import type { Bot, NativeInstallEngine } from "@mycellios/contracts";
import { toast } from "@mycellios/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ProviderLogo } from "../../components/ProviderLogo";
import { useSpaceQueries } from "../../lib/query";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";
import {
  ENGINE_NAMES,
  INSTALL_ENGINES,
  presentEngineUpdate,
  type EngineUpdatePresentation,
} from "./engine-update-presentation";

/** How often the PC is asked again while an install or update runs there. */
const RUNNING_POLL_MS = 2_000;
/** How often an idle PC is asked for newer CLI versions. */
const IDLE_POLL_MS = 10 * 60_000;
/** How long the "updated" note stays before it closes by itself. */
const DONE_DURATION_MS = 6_000;

const toastId = (engine: NativeInstallEngine) => `engine-update-${engine}`;
/** Offers and failures the person closed; the same one is not shown again in this window. */
const closedOffers = new Map<NativeInstallEngine, string>();
/** Notices on screen, and the ones this window closed itself (sonner reports both as dismissed). */
const shown = new Set<string>();
const closing = new Set<string>();
/** "Updated" notes, which stay until they close by themselves. */
const finished = new Set<string>();

function closeNotice(engine: NativeInstallEngine) {
  const id = toastId(engine);
  if (!shown.delete(id)) return;
  closing.add(id);
  toast.dismiss(id);
}

function UpdateDetail({ engine, view }: { engine: NativeInstallEngine; view: EngineUpdatePresentation }) {
  const { t } = useLingui();
  const name = ENGINE_NAMES[engine];
  return (
    <span className="flex flex-col gap-2" data-testid={`engine-update-detail-${engine}`}>
      {view.versions ? <span className="text-muted-foreground tabular-nums">{view.versions}</span> : null}
      {view.error ? <span className="text-destructive">{view.error}</span> : null}
      {view.stage === "running" ? (
        <span className="flex items-center gap-3">
          <span
            role="progressbar"
            aria-label={t`Updating ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={view.percent ?? undefined}
            className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <span
              className={view.percent === null
                ? "absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-primary"
                : "absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"}
              style={view.percent === null ? undefined : { width: `${view.percent}%` }}
            />
          </span>
          {view.percent !== null ? <span className="w-9 text-right text-xs font-medium tabular-nums">{view.percent}%</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Shows the CLI updates of the PC that runs the open Mico as persistent notices at the top right:
 * an offer with Update, live download progress, the failure with Retry, then a short "updated"
 * note. The PC verifies every update as in the model menu; this only asks for it and reports it.
 */
export function EngineUpdateToasts({ bot }: { bot: Bot | null | undefined }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const rpc = useSpaceRpc();
  const botId = bot?.id ?? "";
  const enabled = Boolean(bot && bot.computerMode === "dedicated");
  const running = useRef(new Set<NativeInstallEngine>());
  const targets = useRef(new Map<NativeInstallEngine, { current: string; version: string }>());
  const engines = useQuery({
    ...queries.engines.forBot.queryOptions({ input: { botId } }),
    enabled,
    staleTime: 60_000,
    refetchOnMount: true,
    refetchInterval: (query) =>
      query.state.data?.installing?.some((item) => item.state === "downloading" || item.state === "checking")
        ? RUNNING_POLL_MS
        : IDLE_POLL_MS,
  });
  const { data, refetch } = engines;

  useEffect(() => {
    if (!enabled || !data) return;
    for (const engine of INSTALL_ENGINES) {
      const release = data.updates?.find((item) => item.engine === engine);
      const progress = data.installing?.find((item) => item.engine === engine);
      if (release) targets.current.set(engine, { current: release.current, version: release.version });
      const view = presentEngineUpdate({
        engine,
        release,
        progress,
        target: targets.current.get(engine),
        wasRunning: running.current.has(engine),
      });
      if (view?.stage === "running") running.current.add(engine);
      else running.current.delete(engine);
      const id = toastId(engine);
      if (!view && finished.has(id)) continue;
      finished.delete(id);
      const signature = view ? `${view.stage}:${view.offer ?? ""}:${view.error ?? ""}` : "";
      if (!view || closedOffers.get(engine) === signature) {
        closeNotice(engine);
        continue;
      }
      const name = ENGINE_NAMES[engine];
      const update = async (version: string) => {
        closedOffers.delete(engine);
        try {
          await rpc.engines.install({ botId, engine, version });
        } catch (cause) {
          toast.error(errorText(cause, t`Could not reach the PC. Try again.`));
        }
        void refetch();
      };
      const title = {
        available: t`${name} update available`,
        running: view.checking ? t`Checking ${name}…` : t`Updating ${name}`,
        failed: t`${name} update failed`,
        done: t`${name} updated`,
      }[view.stage];
      const offer = view.offer;
      shown.add(id);
      if (view.stage === "done") finished.add(id);
      toast(title, {
        id,
        position: "top-right",
        className: "engine-update-toast",
        icon: <span aria-hidden className="flex size-5 items-center justify-center"><ProviderLogo name={name} providerId={engine} /></span>,
        description: <UpdateDetail engine={engine} view={view} />,
        action: offer && (view.stage === "available" || view.stage === "failed")
          ? { label: view.stage === "failed" ? t`Retry` : t`Update`, onClick: () => void update(offer) }
          : undefined,
        duration: view.stage === "done" ? DONE_DURATION_MS : Number.POSITIVE_INFINITY,
        dismissible: view.stage !== "running",
        closeButton: view.stage !== "running",
        onAutoClose: () => { shown.delete(id); finished.delete(id); },
        onDismiss: () => {
          shown.delete(id);
          finished.delete(id);
          if (closing.delete(id)) return;
          if (view.stage === "available" || view.stage === "failed") closedOffers.set(engine, signature);
        },
      });
    }
  }, [botId, data, enabled, refetch, rpc, t]);

  // Leaving a Mico (or its PC) closes the notices that belonged to it.
  useEffect(() => () => {
    for (const engine of INSTALL_ENGINES) closeNotice(engine);
  }, [botId]);

  return null;
}
