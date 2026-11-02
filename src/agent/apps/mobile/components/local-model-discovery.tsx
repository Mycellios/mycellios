import { useState } from "react";
import { Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { MenuPicker } from "./menu-picker";
import { NativeActionButton } from "./native-action-button";

export function LocalModelDiscovery({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (baseUrl: string, modelId: string) => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [servers, setServers] = useState<Array<{
    name: string;
    baseUrl: string;
    modelIds: string[];
  }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      setServers(await rpc("models/discoverLocal"));
    } catch {
      setError(t("Local discovery is available to the server owner."));
    } finally {
      setBusy(false);
    }
  }
  const choices =
    servers?.flatMap((server) =>
      server.modelIds.map((modelId) => ({
        key: JSON.stringify([server.baseUrl, modelId]),
        label: `${server.name} · ${modelId}`,
      })),
    ) ?? [];
  return (
    <View style={{ gap: 8 }}>
      <NativeActionButton
        label={t("Find local models on server")}
        busy={busy}
        disabled={disabled}
        prominence="plain"
        onPress={() => void load()}
      />
      {choices.length ? (
        <MenuPicker
          label={t("Local model")}
          value=""
          choices={choices}
          onChange={(key) => {
            if (disabled) return;
            const [baseUrl, id] = JSON.parse(key);
            onSelect(baseUrl, id);
          }}
        />
      ) : null}
      {servers?.length === 0 ? (
        <Text style={{ color: tokens.mutedForeground }}>
          {t("No local servers found on the computer running the server.")}
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
