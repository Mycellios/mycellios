import type { Bot } from "@rakazo/contracts";
import { productBrand } from "@rakazo/contracts";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { MenuPicker } from "./menu-picker";
import { NativeActionButton } from "./native-action-button";

export function AgentEngineSettings({
  botId,
  value,
  onSaved,
}: {
  botId: string;
  value: NonNullable<Bot["agentEngine"]>;
  onSaved: (engine: NonNullable<Bot["agentEngine"]>) => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [engines, setEngines] = useState<
    Array<{ id: NonNullable<Bot["agentEngine"]>; name: string; available: boolean }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      setEngines(await rpc("engines/list"));
    } catch {
      setError(t("Could not check agent engines"));
    } finally {
      setBusy(false);
    }
  }
  async function save(engine: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await rpc("bots/update", { botId, agentEngine: engine });
      onSaved(engine as NonNullable<Bot["agentEngine"]>);
    } catch {
      setError(t("Could not change agent engine"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <NativeActionButton
        label={t("Check agent engines on server")}
        busy={busy}
        prominence="plain"
        onPress={() => void load()}
      />
      {engines.length ? (
        <MenuPicker
          label={t("Agent engine")}
          value={value}
          choices={engines
            .filter((engine) => engine.available)
            .map((engine) => ({ key: engine.id, label: engine.name }))}
          onChange={(engine) => void save(engine)}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function InstalledAgentOnboarding() {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const [engines, setEngines] = useState<Array<{
    id: string;
    name: string;
    available: boolean;
  }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      setEngines(
        (await rpc<Array<{ id: string; name: string; available: boolean }>>("engines/list")).filter(
          (engine) => engine.id !== "pi" && engine.available,
        ),
      );
    } catch {
      setError(t("Could not check agent engines"));
    } finally {
      setBusy(false);
    }
  }
  async function choose(agentEngine: string) {
    setBusy(true);
    setError("");
    try {
      const bots = await rpc<Array<{ id: string; name: string; spawnKey?: string }>>("bots/list");
      const bot =
        bots.find((bot) => bot.spawnKey === "onboarding:first") ??
        (await rpc<{ id: string; name: string }>("bots/create", {
          name: productBrand.companionName,
          spawnKey: "onboarding:first",
        }));
      await rpc("bots/update", { botId: bot.id, agentEngine });
      router.replace({ pathname: "/thread", params: { botId: bot.id, name: bot.name } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not change agent engine"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <NativeActionButton
        label={t("Use an installed agent")}
        busy={busy}
        prominence="plain"
        onPress={() => void load()}
      />
      {engines?.map((engine) => (
        <NativeActionButton
          key={engine.id}
          label={engine.name}
          disabled={busy}
          prominence="secondary"
          onPress={() => void choose(engine.id)}
        />
      ))}
      {engines?.length === 0 ? (
        <Text style={{ color: tokens.mutedForeground }}>
          {t("Install and sign in to an agent on the computer running this server first.")}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
