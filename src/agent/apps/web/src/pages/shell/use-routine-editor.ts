import { useLingui } from "@lingui/react/macro";
import type { Bot, Routine, ThinkingLevel, ThreadSnapshot } from "@mycellios/contracts";
import { routineEventsPath } from "@mycellios/contracts";
import { cronFromPreset, defaultCronPreset } from "@mycellios/core";
import type { ComponentProps, Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useRef, useState } from "react";
import { appPath } from "../../lib/app-path";
import { localTimezone } from "../../lib/local-timezone";
import { parseModelOptionKey } from "../../lib/model-catalog";
import type { Panel } from "../../lib/right-panel-state";
import type { createSpaceRpc } from "../../lib/rpc";
import { sharedInflight } from "../../lib/shared-inflight";
import { errorText } from "../../lib/user-error";
import type { RoutineDraftState, RoutineEditor } from "../RoutineEditor";
import {
  draftFromRoutine,
  emptyRoutineDraft,
  routineNeedsOneShotArm,
  watchFromDraft,
} from "../RoutineEditor";
import { webhookSettingsFromDraft } from "../routine-webhook-draft";

export function useRoutineEditor({
  rpc,
  active,
  activeBotId,
  timezone,
  setBots,
  refreshThread,
  setPanel,
  messageProviders,
  onOpenRoutineRun,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  active: Bot | undefined;
  activeBotId: RefObject<string | undefined>;
  timezone: string | null | undefined;
  messageProviders: string[];
  setBots: Dispatch<SetStateAction<Bot[]>>;
  refreshThread: (botId: string) => Promise<ThreadSnapshot>;
  setPanel: (panel: Panel) => void;
  onOpenRoutineRun?: (target: { botId: string; taskThreadId?: string; groupId?: string }) => void;
}) {
  const { t } = useLingui();
  const [routineDraft, setRoutineDraft] = useState<RoutineDraftState>(emptyRoutineDraft());
  const [routineWebhookSecret, setRoutineWebhookSecret] = useState<string | null>(null);
  // A routine's own secret, shown once after Create or Rotate.
  const [routineEventSecret, setRoutineEventSecret] = useState<{ routineId: string; secret: string } | null>(null);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const webhookPending = useRef(false);
  const routineTestEventRequest = useRef<{ routineId: string; nonce: string } | null>(null);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [deleteRoutineTarget, setDeleteRoutineTarget] = useState<Routine | null>(null);
  const [savingRoutine, setSavingRoutine] = useState(false);
  const [runningRoutine, setRunningRoutine] = useState(false);
  const routineTestRequest = useRef<{ routineId: string; nonce: string } | null>(null);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const routineSavePending = useRef(false);
  const webhookSecretProvisionRef = useRef(new Map<string, Promise<string>>());
  const ensureWebhookSecret = (botId: string) =>
    sharedInflight(webhookSecretProvisionRef.current, botId, async () => {
      const result = await rpc.bots.rotateWebhookSecret({ botId });
      setRoutineWebhookSecret(result.secret);
      setBots((current) =>
        current.map((bot) => (bot.id === botId ? { ...bot, webhookConfigured: true } : bot)),
      );
      return result.secret;
    });
  const routineSaveRequest = useRef(0);
  const routineRunPending = useRef(false);
  const addSkillRoutine = useCallback((name: string, prompt: string) => {
    setRoutineDraft({ ...emptyRoutineDraft(), name, prompt });
    setRoutineError(null);
    setRoutineWebhookSecret(null);
    setRoutineEventSecret(null);
    setEditingRoutine(null);
    setPanel("routine");
  }, []);

  function restoreRoutine(routine: Routine | null) {
    setEditingRoutine(routine);
    setRoutineDraft(routine ? draftFromRoutine(routine) : emptyRoutineDraft());
    setRoutineWebhookSecret(null);
    setRoutineEventSecret(null);
  }
  function startRoutine(routine?: Routine, draft = emptyRoutineDraft()) {
    setRoutineDraft(routine ? draftFromRoutine(routine) : draft);
    setRoutineWebhookSecret(null);
    setRoutineEventSecret(null);
    setEditingRoutine(routine ?? null);
    setRoutineError(null);
    setPanel("routine");
  }
  function prepareMorningBriefing() {
    startRoutine(undefined, {
      ...emptyRoutineDraft(),
      name: t`Morning briefing`,
      prompt: t`Read today's calendar and the emails that need a reply using the connected accounts I have authorized. Summarize meetings that need preparation, schedule conflicts, and messages that need a decision. Keep it short and identify the source of each item. If a source is unavailable, state which one. If all selected sources are available and there is nothing I need to act on, finish without posting an update. Read only. Do not send, modify, or delete anything.`,
      schedules: [{ ...defaultCronPreset(), freq: "Weekdays" }],
      active: false,
    });
  }
  function resetRoutineTarget() {
    setEditingRoutine(null);
    setDeleteRoutineTarget(null);
  }
  function leaveRoutine() {
    routineSaveRequest.current += 1;
    setRoutineError(null);
  }
  /** Rotate, revoke or test the saved routine's own webhook, one action at a time. */
  async function routineWebhookAction(
    action: (routine: Routine) => Promise<void>,
    fallback: string,
  ) {
    const target = editingRoutine;
    if (!target || webhookPending.current) return;
    webhookPending.current = true;
    setWebhookBusy(true);
    setRoutineError(null);
    try {
      await action(target);
    } catch (error) {
      if (activeBotId.current === target.botId) setRoutineError(errorText(error, fallback));
    } finally {
      webhookPending.current = false;
      setWebhookBusy(false);
    }
  }
  const followWebhookState = (routineId: string, webhook: Routine["webhook"]) =>
    setEditingRoutine((current) => (current?.id === routineId ? { ...current, webhook } : current));
  const routineEventsUrl =
    editingRoutine?.webhookEnabled && editingRoutine.webhook
      ? typeof window !== "undefined"
        ? `${window.location.origin}${appPath(routineEventsPath(editingRoutine.id))}`
        : appPath(routineEventsPath(editingRoutine.id))
      : null;
  const editorProps = active
    ? ({
        draft: routineDraft,
        onChange: setRoutineDraft,
        editing: editingRoutine,
        timezone: editingRoutine?.timezone ?? timezone ?? localTimezone(),
        webhook: {
          path:
            typeof window !== "undefined"
              ? `${window.location.origin}${appPath(`/api/v1/bots/${active.id}/webhook`)}`
              : appPath(`/api/v1/bots/${active.id}/webhook`),
          secret: routineWebhookSecret,
          configured: active.webhookConfigured || Boolean(routineWebhookSecret),
        },
        routineWebhook: {
          url: routineEventsUrl,
          secret:
            routineEventSecret && routineEventSecret.routineId === editingRoutine?.id
              ? routineEventSecret.secret
              : null,
          busy: webhookBusy,
          onRotate: () =>
            void routineWebhookAction(async (routine) => {
              const result = await rpc.routines.rotateWebhookSecret({ routineId: routine.id });
              setRoutineEventSecret({ routineId: routine.id, secret: result.secret });
              followWebhookState(routine.id, result.webhook);
            }, t`Could not create the secret`),
          onRevoke: () =>
            void routineWebhookAction(async (routine) => {
              const result = await rpc.routines.revokeWebhookSecret({ routineId: routine.id });
              setRoutineEventSecret(null);
              followWebhookState(routine.id, result.webhook);
            }, t`Could not revoke the secrets`),
          onSendTest: () =>
            void routineWebhookAction(async (routine) => {
              if (routineTestEventRequest.current?.routineId !== routine.id)
                routineTestEventRequest.current = { routineId: routine.id, nonce: crypto.randomUUID() };
              const started = await rpc.routines.sendTestEvent({
                routineId: routine.id,
                clientNonce: routineTestEventRequest.current.nonce,
              });
              routineTestEventRequest.current = null;
              if (activeBotId.current !== routine.botId) return;
              // Do not discard an unsaved editor draft to follow the run automatically.
              if ((started.taskThreadId || started.groupId) && onOpenRoutineRun &&
                JSON.stringify(routineDraft) === JSON.stringify(draftFromRoutine(routine))) {
                onOpenRoutineRun({ botId: routine.botId, ...started });
                return;
              }
              await refreshThread(routine.botId);
            }, t`Could not send the test event`),
        },
        githubPath:
          typeof window !== "undefined"
            ? `${window.location.origin}${appPath(`/api/v1/bots/${active.id}/github`)}`
            : appPath(`/api/v1/bots/${active.id}/github`),
        messageProviders,
        saving: savingRoutine,
        running: runningRoutine,
        error: routineError,
        onBack: () => setPanel("computer"),
        onClose: () => setPanel(null),
        onEnsureWebhook: async () => {
          await ensureWebhookSecret(active.id);
        },
        onSave: async () => {
          if (routineSavePending.current) return;
          const targetBotId = active.id;
          const targetRoutine = editingRoutine;
          if (targetRoutine && targetRoutine.botId !== targetBotId) return;
          if (
            !routineDraft.schedules.length &&
            !routineDraft.webhookEnabled &&
            !routineDraft.githubEnabled &&
            !routineDraft.messageProvider &&
            !routineDraft.watch
          ) {
            setRoutineError(t`Add a trigger to run this routine.`);
            return;
          }
          const watchResult = routineDraft.watch ? watchFromDraft(routineDraft.watch) : null;
          if (watchResult && "error" in watchResult) {
            setRoutineError(watchResult.error);
            return;
          }
          const watch = watchResult?.watch ?? null;
          const webhookSettings = routineDraft.webhookEnabled
            ? webhookSettingsFromDraft(routineDraft)
            : null;
          if (webhookSettings && "error" in webhookSettings) {
            setRoutineError(webhookSettings.error);
            return;
          }
          const saveRequest = ++routineSaveRequest.current;
          routineSavePending.current = true;
          setSavingRoutine(true);
          setRoutineError(null);
          try {
            // GitHub events are signed with the Mico's key; a webhook gets its own secret once saved.
            if (routineDraft.githubEnabled && !active.webhookConfigured && !routineWebhookSecret) {
              await ensureWebhookSecret(targetBotId);
            }
            const crons = routineDraft.schedules.map(cronFromPreset);
            const model = routineDraft.modelKey ? parseModelOptionKey(routineDraft.modelKey) : null;
            const routineModel = {
              modelProvider: model?.provider ?? null,
              modelId: model?.modelId ?? null,
              thinkingLevel: (model && routineDraft.thinkingLevel
                ? routineDraft.thinkingLevel
                : null) as ThinkingLevel | null,
            };
            let saved: Routine;
            if (targetRoutine) {
              const armOneShot = routineNeedsOneShotArm(targetRoutine, crons);
              let runAt: string | undefined;
              if (armOneShot) {
                if (!routineDraft.runAtLocal) {
                  setRoutineError(t`Add a run time for this one-shot.`);
                  return;
                }
                const parsed = new Date(routineDraft.runAtLocal);
                if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
                  setRoutineError(t`Run time must be in the future.`);
                  return;
                }
                runAt = parsed.toISOString();
              }
              saved = await rpc.routines.update({
                routineId: targetRoutine.id,
                name: routineDraft.name || t`Routine`,
                prompt: routineDraft.prompt || t`Check in.`,
                crons,
                active: armOneShot ? true : routineDraft.active,
                notify: routineDraft.notify ?? targetRoutine.notify,
                isolatedBrowser: routineDraft.isolatedBrowser,
                webhookEnabled: routineDraft.webhookEnabled,
                githubEnabled: routineDraft.githubEnabled,
                messageProvider: routineDraft.messageProvider,
                watch,
                ...(routineModel.modelProvider !== targetRoutine.modelProvider ||
                routineModel.modelId !== targetRoutine.modelId ||
                routineModel.thinkingLevel !== targetRoutine.thinkingLevel
                  ? routineModel
                  : {}),
                ...(runAt ? { runAt } : {}),
                ...(webhookSettings ?? {}),
                // Only a change is sent, so a group routine or an older server is left alone.
                ...(routineDraft.runIn && routineDraft.runIn !== targetRoutine.runIn
                  ? { runIn: routineDraft.runIn }
                  : {}),
              });
            } else {
              saved = await rpc.routines.create({
                botId: targetBotId,
                name: routineDraft.name || t`Routine`,
                prompt: routineDraft.prompt || t`Check in.`,
                crons,
                timezone: timezone ?? localTimezone(),
                active: routineDraft.active,
                notify: routineDraft.notify ?? true,
                isolatedBrowser: routineDraft.isolatedBrowser,
                webhookEnabled: routineDraft.webhookEnabled,
                githubEnabled: routineDraft.githubEnabled,
                messageProvider: routineDraft.messageProvider,
                watch,
                ...routineModel,
                ...(webhookSettings ?? {}),
                ...(routineDraft.runIn ? { runIn: routineDraft.runIn } : {}),
              });
            }
            if (routineSaveRequest.current === saveRequest && activeBotId.current === targetBotId) {
              setEditingRoutine(saved);
              setRoutineDraft(draftFromRoutine(saved));
            }
          } catch (error) {
            if (routineSaveRequest.current !== saveRequest || activeBotId.current !== targetBotId) {
              return;
            }
            setRoutineError(errorText(error, t`Could not save routine`));
            return;
          } finally {
            routineSavePending.current = false;
            setSavingRoutine(false);
          }
          if (routineSaveRequest.current !== saveRequest || activeBotId.current !== targetBotId) {
            return;
          }
          await refreshThread(targetBotId).catch(() => undefined);
        },
        onTestRun: async () => {
          if (routineRunPending.current) return;
          const targetBotId = active.id;
          const targetRoutine = editingRoutine;
          if (!targetRoutine) return;
          routineRunPending.current = true;
          setRunningRoutine(true);
          setRoutineError(null);
          try {
            if (routineTestRequest.current?.routineId !== targetRoutine.id)
              routineTestRequest.current = { routineId: targetRoutine.id, nonce: crypto.randomUUID() };
            const started = await rpc.routines.testRun({ routineId: targetRoutine.id, clientNonce: routineTestRequest.current.nonce });
            routineTestRequest.current = null;
            // Do not discard an unsaved editor draft to follow the run automatically.
            if (activeBotId.current === targetBotId && (started.taskThreadId || started.groupId) &&
              JSON.stringify(routineDraft) === JSON.stringify(draftFromRoutine(targetRoutine))) {
              onOpenRoutineRun?.({ botId: targetBotId, ...started });
              if (onOpenRoutineRun) return;
            }
            await refreshThread(targetBotId);
          } catch (error) {
            if (activeBotId.current === targetBotId) {
              setRoutineError(errorText(error, t`Could not run routine`));
            }
          } finally {
            routineRunPending.current = false;
            setRunningRoutine(false);
          }
        },
        onDelete: () => {
          if (editingRoutine) {
            setDeleteRoutineTarget(editingRoutine);
            return;
          }
          setPanel("computer");
        },
      } satisfies ComponentProps<typeof RoutineEditor>)
    : null;
  const deleteDialogProps = deleteRoutineTarget
    ? {
        item: deleteRoutineTarget,
        noun: "routine" as const,
        onCancel: () => setDeleteRoutineTarget(null),
        onConfirm: async () => {
          const target = deleteRoutineTarget;
          await rpc.routines.remove({ routineId: target.id });
          setDeleteRoutineTarget(null);
          setEditingRoutine((current) => (current?.id === target.id ? null : current));
          if (activeBotId.current !== target.botId) return;
          await refreshThread(target.botId);
          if (activeBotId.current === target.botId) setPanel("computer");
        },
      }
    : null;
  return {
    editorProps,
    deleteDialogProps,
    editingRoutine,
    restoreRoutine,
    startRoutine,
    prepareMorningBriefing,
    resetRoutineTarget,
    leaveRoutine,
    addSkillRoutine,
  };
}
