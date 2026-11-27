import { useLingui } from "@lingui/react/macro";
import type { LocalModelInfo, LocalModelsStatus } from "@mycellios/contracts";
import { Button, Spinner } from "@mycellios/ui-web";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatModelSize, useLocalModels } from "../../lib/local-models";
import { errorText } from "../../lib/user-error";

/** Words per second people can picture, from tokens per second. */
const wordsPerSecond = (model: LocalModelInfo) => Math.max(1, Math.round(model.speed.generation * 0.75));

function FitPill({ model }: { model: LocalModelInfo }) {
  const { t } = useLingui();
  const label = model.fit === "fast" ? t`Fast` : model.fit === "slower" ? t`Slower` : model.fit === "very-slow" ? t`Very slow` : t`Doesn't fit`;
  return <span data-fit={model.fit} className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] leading-none ${model.fit === "fast"
    ? "border-border bg-background text-foreground" : "border-transparent bg-muted text-muted-foreground"}`}>{label}</span>;
}

function InstallProgress({ status, onCancel }: { status: LocalModelsStatus; onCancel: () => void }) {
  const { t } = useLingui();
  const job = status.job!;
  const model = status.models.find((entry) => entry.id === job.modelId);
  const phase = job.phase === "engine" ? t`Preparing this PC…` : job.phase === "download" ? t`Downloading ${model?.name ?? ""}…`
    : job.phase === "verify" ? t`Checking the download…` : job.phase === "load" ? t`Loading the model…` : t`Measuring its speed on this PC…`;
  const share = job.phase === "download" && job.total ? Math.min(1, job.downloaded / job.total) : job.phase === "engine" ? 0 : 1;
  return <div className="grid gap-2 px-1 py-1" role="status" aria-live="polite">
    <p className="text-sm">{phase}</p>
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
    <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
      <span>{job.phase === "download" ? `${formatModelSize(job.downloaded)} / ${formatModelSize(job.total)}` : t`This only happens once.`}</span>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{t`Cancel`}</Button>
    </div>
  </div>;
}

/**
 * "On your PC" in the chat model picker (specs/local-models/spec.md): the installed local
 * models, and one button that installs the fastest model this PC runs well.
 */
export function LocalModelsPanel({ value, onUse, disabled = false }: {
  /** The model id this Mico uses now, when it is a local one. */
  value?: string | null;
  onUse: (modelId: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const { status, error, busy, act } = useLocalModels();
  const [adding, setAdding] = useState(false);
  const [showSmarter, setShowSmarter] = useState(false);
  const inspected = useRef(false);
  // The engine reads this PC's devices; until then the recommendation is only a guess.
  useEffect(() => {
    if (!status || status.inspected || !status.supported || inspected.current) return;
    inspected.current = true;
    void act((bridge) => bridge.inspect()).catch(() => undefined);
  }, [status, act]);

  if (!status) return error
    ? <p role="alert" className="px-1 py-2 text-xs text-destructive">{errorText(error)}</p>
    : <div className="grid min-h-24 place-items-center"><Spinner aria-label={t`Checking your PC…`} className="text-muted-foreground" /></div>;
  if (!status.supported) return <p className="px-1 py-2 text-sm text-muted-foreground">{t`Models on your PC are not available for this computer yet.`}</p>;

  const installed = status.models.filter((model) => model.installed);
  const install = (modelId: string) => act(async (bridge) => {
    await bridge.install(modelId);
    await onUse(modelId);
    setAdding(false); setShowSmarter(false);
  }).catch(() => undefined);
  if (status.job && !status.job.error) return <InstallProgress status={status} onCancel={() => void act((bridge) => bridge.cancel()).catch(() => undefined)} />;

  const recommended = status.models.find((model) => model.id === status.recommended);
  const smarter = status.models.find((model) => model.id === status.smarter);
  const offer = !installed.length || adding;
  return <div className="grid gap-2">
    {installed.length ? <ul className="grid gap-0.5" aria-label={t`Models on this PC`}>
      {installed.map((model) => <li key={model.id}>
        <button type="button" disabled={disabled || busy} aria-pressed={model.id === value}
          onClick={() => void onUse(model.id)}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm hover:bg-accent disabled:opacity-60">
          <span className="min-w-0 flex-1 truncate">{model.name}</span>
          <FitPill model={model} />
          {model.id === value ? <Check size={14} aria-hidden className="shrink-0" /> : <span className="w-3.5 shrink-0" />}
        </button>
      </li>)}
    </ul> : null}
    {offer ? <div className="grid gap-3 rounded-lg border border-border p-3">
      <div className="grid gap-1">
        <p className="text-sm font-medium">{t`Use a model on your PC`}</p>
        <p className="text-xs text-muted-foreground">{t`Free and private: it runs on this PC without Credits, and your messages never leave it.`}</p>
      </div>
      {/* Until the engine has read this PC's devices the recommendation is only a guess: show none. */}
      {!status.inspected ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" />{t`Checking your PC…`}</p>
        : recommended ? <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{recommended.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatModelSize(recommended.bytes)}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t`Answers right away, about ${wordsPerSecond(recommended)} words per second on this PC.`}</p>
        <Button type="button" disabled={disabled || busy || !status.inspected} onClick={() => void install(recommended.id)}>
          {recommended.installed ? t`Use it` : t`Install and use`}
        </Button>
      </div> : <p className="text-xs text-muted-foreground">{t`This PC is too slow for models that answer quickly. The free models in Mycellios work better here.`}</p>}
      {smarter && status.inspected ? showSmarter ? <div className="grid gap-2 border-t border-border pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{smarter.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatModelSize(smarter.bytes)}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t`Smarter but slower: about ${wordsPerSecond(smarter)} words per second on this PC.`}</p>
        <Button type="button" variant="outline" disabled={disabled || busy || !status.inspected} onClick={() => void install(smarter.id)}>
          {smarter.installed ? t`Use it` : t`Install and use`}
        </Button>
      </div> : <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => setShowSmarter(true)}>{t`Smarter, slower`}</Button> : null}
      {status.job?.error ? <p role="alert" className="text-xs text-destructive">{status.job.error === "Cancelled" ? t`Installation cancelled.` : t`The model could not be installed. Try again to resume the download.`}</p> : null}
      {error && !status.job?.error ? <p role="alert" className="text-xs text-destructive">{errorText(error)}</p> : null}
    </div> : <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => setAdding(true)}>{t`Add another model`}</Button>}
  </div>;
}
