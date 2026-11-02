import type { AgentSkill, AgentSkillCatalogEntry } from "@rakazo/contracts";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { MenuPicker } from "../../components/menu-picker";
import { NativeActionButton } from "../../components/native-action-button";
import { rpc } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useMobileTokens } from "../../lib/native";

export default function Skills() {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [list, setList] = useState<AgentSkillCatalogEntry[]>([]);
  const [skill, setSkill] = useState<AgentSkill | null>(null);
  const [bots, setBots] = useState<Array<{ id: string; name: string }>>([]);
  const [botId, setBotId] = useState("");
  const [history, setHistory] = useState<AgentSkill[]>([]);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void rpc<AgentSkillCatalogEntry[]>("agentSkills/list")
      .then((rows) => {
        if (alive) setList(rows);
      })
      .catch(() => {
        if (alive) setError(t("Could not load skills"));
      });
    return () => {
      alive = false;
    };
  }, [t]);
  async function select(skillId: string) {
    setBusy(true);
    setError("");
    try {
      setBots(await rpc("bots/list"));
      const next = await rpc<AgentSkill>("agentSkills/get", { skillId });
      setSkill(next);
      setContent(next.content);
      setHistory(next.readOnly ? [] : await rpc("agentSkills/history", { skillId }));
    } catch {
      setError(t("Could not load skill"));
    } finally {
      setBusy(false);
    }
  }
  async function save(revision?: number) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await rpc<AgentSkill>(
        skill
          ? revision === undefined
            ? "agentSkills/update"
            : "agentSkills/restore"
          : "agentSkills/create",
        skill
          ? {
              skillId: skill.id,
              expectedRevision: skill.revision,
              ...(revision === undefined ? { content } : { revision }),
            }
          : { content },
      );
      setSkill(next);
      setContent(next.content);
      setHistory(await rpc("agentSkills/history", { skillId: next.id }));
      setList(await rpc("agentSkills/list"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not save skill"));
    } finally {
      setBusy(false);
    }
  }
  async function pin(revision: number | null) {
    if (!skill || !botId || busy) return;
    setBusy(true);
    setError("");
    try {
      await rpc("agentSkills/pin", { skillId: skill.id, botId, revision });
    } catch {
      setError(t("Could not save agent skill version"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, gap: 16 }}
    >
      <Stack.Screen options={{ title: t("Skills") }} />
      {list.length ? (
        <MenuPicker
          label={t("Skill")}
          value={skill?.id ?? ""}
          choices={list.map((row) => ({ key: row.id, label: row.name }))}
          onChange={(id) => {
            if (!busy) void select(id);
          }}
        />
      ) : null}
      <NativeActionButton
        label={t("New skill")}
        disabled={busy}
        prominence="secondary"
        onPress={() => {
          setSkill(null);
          setHistory([]);
          setContent("---\nname: new-skill\ndescription: Describe when to use this skill\n---\n\n");
        }}
      />
      {content ? (
        <>
          <TextInput
            accessibilityLabel={t("Skill content")}
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={100000}
            editable={!busy && !skill?.readOnly}
            autoCorrect={false}
            autoCapitalize="none"
            textAlignVertical="top"
            style={{
              minHeight: 280,
              padding: 12,
              color: tokens.foreground,
              backgroundColor: tokens.card,
              borderRadius: 12,
            }}
          />
          {!skill?.readOnly ? (
            <NativeActionButton
              label={t("Save")}
              disabled={busy || content === skill?.content}
              onPress={() => void save()}
            />
          ) : null}
          {skill && !skill.readOnly ? (
            <View style={{ gap: 8 }}>
              <MenuPicker
                label={t("Skill version for an agent")}
                value={botId}
                choices={[
                  { key: "", label: t("Choose an agent") },
                  ...bots.map((bot) => ({ key: bot.id, label: bot.name })),
                ]}
                onChange={setBotId}
              />
              <NativeActionButton
                label={t("Use current version")}
                disabled={busy || !botId}
                prominence="secondary"
                onPress={() => void pin(skill.revision)}
              />
              <NativeActionButton
                label={t("Follow latest")}
                disabled={busy || !botId}
                prominence="plain"
                onPress={() => void pin(null)}
              />
            </View>
          ) : null}
          {history.map((version) => (
            <View
              key={version.revision}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Text style={{ color: tokens.foreground }}>
                {t("Version")} {version.revision}
              </Text>
              {version.revision !== skill?.revision ? (
                <NativeActionButton
                  label={t("Restore")}
                  disabled={busy}
                  prominence="plain"
                  onPress={() => void save(version.revision)}
                />
              ) : (
                <Text style={{ color: tokens.mutedForeground }}>{t("Current")}</Text>
              )}
            </View>
          ))}
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}
