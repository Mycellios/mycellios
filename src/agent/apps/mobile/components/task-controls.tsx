import { useState } from "react";
import { Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { MenuPicker } from "./menu-picker";
import { NativeActionButton } from "./native-action-button";

type Task = {
  taskId: string;
  version: number;
  paused: boolean;
  active: boolean;
  botId: string;
  runId: string;
  bots: Array<{ id: string; name: string }>;
};
export function TaskControls({ runId }: { runId: string }) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      setTask(await rpc("tasks/get", { runId }));
    } catch {
      setError(t("Could not load task controls"));
    } finally {
      setBusy(false);
    }
  }
  async function control(action: "pause" | "resume" | "reassign", botId?: string) {
    if (!task || busy) return;
    setBusy(true);
    setError("");
    try {
      const changed = await rpc<Pick<Task, "version" | "paused" | "runId">>("tasks/control", {
        runId: task.runId,
        expectedVersion: task.version,
        action,
        botId,
      });
      setTask({ ...task, ...changed, active: !changed.paused, botId: botId ?? task.botId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not update task"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
      {task ? (
        <>
          <NativeActionButton
            busy={busy}
            disabled={!task.paused && !task.active}
            label={task.paused && !task.active ? t("Resume") : t("Pause")}
            prominence="plain"
            onPress={() => void control(task.paused && !task.active ? "resume" : "pause")}
          />
          {task.paused && !task.active ? (
            <MenuPicker
              label={t("Reassign and resume")}
              value={task.botId}
              choices={task.bots.map((bot) => ({ key: bot.id, label: bot.name }))}
              onChange={(botId) => {
                if (botId !== task.botId) void control("reassign", botId);
              }}
            />
          ) : null}
        </>
      ) : (
        <NativeActionButton
          busy={busy}
          label={t("Task controls")}
          prominence="plain"
          onPress={() => void load()}
        />
      )}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
