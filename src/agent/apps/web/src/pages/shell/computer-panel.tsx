import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { Bot, ComputerStatus, Routine } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { Maximize2 } from "lucide-react";
import type { ReactNode } from "react";
import { ComputersUnavailableHint } from "../../components/ComputersUnavailableHint";
import { screenIframeSandbox } from "../../lib/computer-screen";
import { RoutineListHeader, RoutineListRow } from "../RoutineEditor";
import { computerLabel, computerPlaceholder, DesktopKindEmptyState } from "./computer-view";

type ComputerPanelProps = {
  bot: Bot;
  computer: ComputerStatus | null;
  computerOpen: boolean;
  embeddedScreenUrl: string | null;
  /** Changes to load the screen again in a new frame. */
  screenFrameKey?: number;
  screenFrameRef: (frame: HTMLIFrameElement | null) => void;
  computerScreenError: ReactNode;
  computerBooting: ReactNode;
  booting: boolean;
  showingRecoveryHint: boolean;
  showComputerRecoveryHint: boolean;
  sandboxProvider?: string | null;
  onRecovered: (sandboxProvider: string) => void;
  onRecoveryDismissed: () => void;
  onOpenBrowser?: () => void;
  onOpenComputerSettings?: () => void;
  onOpenBotSettings?: () => void;
  onOpen: () => void;
  routines: Routine[];
  runningRoutineId?: string;
  onCreateRoutine: () => void;
  onEditRoutine: (routine: Routine) => void;
  onStopRun: () => void;
};

export function ComputerPanel({
  bot,
  computer,
  computerOpen,
  embeddedScreenUrl,
  screenFrameKey,
  screenFrameRef,
  computerScreenError,
  computerBooting,
  booting,
  showingRecoveryHint,
  showComputerRecoveryHint,
  sandboxProvider,
  onRecovered,
  onRecoveryDismissed,
  onOpenBrowser,
  onOpenComputerSettings,
  onOpenBotSettings,
  onOpen,
  routines,
  runningRoutineId,
  onCreateRoutine,
  onEditRoutine,
  onStopRun,
}: ComputerPanelProps) {
  return (
    <div className="space-y-5 p-5">
      <div
        data-testid="computer-preview"
        className={`group relative rounded-[14px] bg-background ${
          showingRecoveryHint ? "" : "aspect-[16/10] overflow-hidden"
        }`}
      >
        {computerOpen ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground/80">
            <Trans>Open in full window</Trans>
          </div>
        ) : computer?.kind === "desktop" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground/80">
            <DesktopKindEmptyState />
            {onOpenBrowser && <Button variant="secondary" size="sm" onClick={onOpenBrowser}><Trans>Open browser</Trans></Button>}
          </div>
        ) : computer?.state === "running" && embeddedScreenUrl && !computerScreenError ? (
          <iframe
            key={screenFrameKey}
            title={t`Bot screen preview`}
            ref={screenFrameRef}
            src={embeddedScreenUrl}
            sandbox={screenIframeSandbox(embeddedScreenUrl)}
            className="h-full w-full border-0 bg-black"
            allow="clipboard-read; clipboard-write"
            style={{ pointerEvents: "none" }}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground/80">
            {computerScreenError ??
              (showComputerRecoveryHint ? (
                <div className="space-y-3 text-center">
                  <p className="font-medium text-foreground"><Trans>Computer unavailable</Trans></p>
                  <p><Trans>Use Browser for pages and previews. Computer shows the Mico’s working environment when it is connected.</Trans></p>
                  {onOpenBrowser && <Button variant="secondary" size="sm" onClick={onOpenBrowser}><Trans>Open browser</Trans></Button>}
                </div>
              ) : (
                (computerBooting ??
                computerPlaceholder(
                  computer?.state,
                  booting,
                  computerLabel(computer?.mode, bot.name),
                ))
              ))}
          </div>
        )}
        {!computerOpen && computer?.kind !== "desktop" && computer?.state === "running" && embeddedScreenUrl && !computerScreenError && !showingRecoveryHint ? (
          <button
            type="button"
            data-testid="computer-preview-open"
            className="absolute inset-0 flex cursor-pointer items-center justify-center bg-overlay/40 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t`Open`}
            onClick={onOpen}
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-overlay px-3.5 py-2 text-[14px] text-foreground shadow-md">
              <Maximize2 size={15} strokeWidth={1.9} aria-hidden />
              <Trans>Open</Trans>
            </span>
          </button>
        ) : null}
      </div>
      <Disclosure summary={t`Connection and diagnostics`} summaryClassName="w-full py-2 text-sm text-muted-foreground">
        <ComputersUnavailableHint sandboxProvider={sandboxProvider} onRecovered={onRecovered} onRecoveryDismissed={onRecoveryDismissed} onOpenComputerSettings={onOpenComputerSettings} />
      {computer?.state !== "running" && onOpenBotSettings ? (
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onOpenBotSettings}>
          <Trans>Open Mico settings</Trans>
        </Button>
      ) : null}
      </Disclosure>
      {computer?.state === "running" && embeddedScreenUrl && <p className="mt-2 truncate text-[13.5px] text-muted-foreground" dir="auto">
        {t`${bot.name}'s screen`}
      </p>}

      <Disclosure summary={t`Routines for this Mico`} summaryClassName="w-full py-2 text-sm text-muted-foreground">
      <RoutineListHeader onCreate={onCreateRoutine} />
      {routines.map((routine) => (
        <RoutineListRow
          key={routine.id}
          routine={routine}
          running={runningRoutineId === routine.id}
          onOpen={() => onEditRoutine(routine)}
          onStop={onStopRun}
        />
      ))}
      </Disclosure>
    </div>
  );
}
