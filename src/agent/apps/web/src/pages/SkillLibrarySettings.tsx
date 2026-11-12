import { Trans, useLingui } from "@lingui/react/macro";
import type { AgentSkill, AgentSkillCatalogEntry } from "@rakazo/contracts";
import { Button, Disclosure, NativeSelect, NativeSelectOption, Textarea } from "@rakazo/ui-web";
import { useEffect, useId, useRef, useState } from "react";
import { useSpaceRpc } from "../lib/space-rpc";

export function SkillLibrarySettings() {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const loadError = t`Could not load skills`;
  const id = useId();
  const [list, setList] = useState<AgentSkillCatalogEntry[]>([]);
  const [skill, setSkill] = useState<AgentSkill | null>(null);
  const [bots, setBots] = useState<Array<{ id: string; name: string }>>([]);
  const [botId, setBotId] = useState("");
  const [pinNotice, setPinNotice] = useState("");
  const [history, setHistory] = useState<AgentSkill[]>([]);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setBusy(true);
    void rpc.agentSkills
      .list()
      .then((rows) => {
        if (generation.current === request) setList(rows);
      })
      .catch(() => {
        if (generation.current === request) setError(loadError);
      })
      .finally(() => {
        if (generation.current === request) setBusy(false);
      });
    return () => {
      ++generation.current;
    };
  }, [rpc, loadError]);
  async function pin(revision: number | null) {
    if (!skill || !botId) return;
    setBusy(true);
    setError("");
    setPinNotice("");
    try {
      await rpc.agentSkills.pin({ skillId: skill.id, botId, revision });
      setPinNotice(
        revision === null ? t`Agent follows the latest version` : t`Version saved for this agent`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not save agent skill version`);
    } finally {
      setBusy(false);
    }
  }
  async function select(skillId: string) {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setPinNotice("");
    try {
      const ownedBots = await rpc.bots.list();
      setBots(ownedBots);
      const saved = await rpc.agentSkills.get({ skillId });
      const versions = saved.readOnly ? [] : await rpc.agentSkills.history({ skillId });
      if (generation.current !== request) return;
      setSkill(saved);
      setContent(saved.content);
      setHistory(versions);
    } catch {
      if (generation.current === request) setError(t`Could not load skill`);
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  async function save(revision?: number) {
    setBusy(true);
    setError("");
    try {
      const saved = skill
        ? revision === undefined
          ? await rpc.agentSkills.update({
              skillId: skill.id,
              expectedRevision: skill.revision,
              content,
            })
          : await rpc.agentSkills.restore({
              skillId: skill.id,
              expectedRevision: skill.revision,
              revision,
            })
        : await rpc.agentSkills.create({ content });
      setSkill(saved);
      setContent(saved.content);
      setHistory(await rpc.agentSkills.history({ skillId: saved.id }));
      setList(await rpc.agentSkills.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not save skill`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Disclosure alwaysVisible summary={t`Skills`}>
      <div className="space-y-3 pt-3">
        <div className="flex flex-wrap gap-2">
          {list.map((row) => (
            <Button
              key={row.id}
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void select(row.id)}
            >
              {row.name}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              ++generation.current;
              setSkill(null);
              setHistory([]);
              setError("");
              setContent(
                "---\nname: new-skill\ndescription: Describe when to use this skill\n---\n\n",
              );
            }}
          >
            <Trans>New skill</Trans>
          </Button>
        </div>
        {content ? (
          <>
            <label className="block text-sm" htmlFor={`${id}-content`}>
              {skill?.name ?? t`SKILL.md`}
            </label>
            <Textarea
              id={`${id}-content`}
              value={content}
              maxLength={100000}
              rows={12}
              readOnly={skill?.readOnly}
              disabled={busy}
              onChange={(event) => setContent(event.target.value)}
            />
            {!skill?.readOnly ? (
              <Button
                size="sm"
                disabled={busy || !content.trim() || content === skill?.content}
                onClick={() => void save()}
              >
                <Trans>Save</Trans>
              </Button>
            ) : null}
            {skill && !skill.readOnly ? (
              <div className="space-y-2">
                <label htmlFor={`${id}-bot`} className="text-sm">
                  <Trans>Skill version for an agent</Trans>
                </label>
                <NativeSelect
                  id={`${id}-bot`}
                  value={botId}
                  disabled={busy}
                  onChange={(event) => {
                    setBotId(event.target.value);
                    setPinNotice("");
                  }}
                >
                  <NativeSelectOption value="">{t`Choose an agent`}</NativeSelectOption>
                  {bots.map((bot) => (
                    <NativeSelectOption key={bot.id} value={bot.id}>
                      {bot.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !botId}
                  onClick={() => void pin(skill.revision)}
                >
                  <Trans>Use current version</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !botId}
                  onClick={() => void pin(null)}
                >
                  <Trans>Follow latest</Trans>
                </Button>
                {pinNotice ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {pinNotice}
                  </p>
                ) : null}
              </div>
            ) : null}
            {history.length ? (
              <ol className="space-y-2" aria-label={t`Version history`}>
                {history.map((version) => (
                  <li
                    key={version.revision}
                    className="flex flex-wrap items-center justify-between gap-3 text-sm"
                  >
                    <span>
                      <Trans>Version {version.revision}</Trans> ·{" "}
                      {new Date(version.updatedAt).toLocaleString()}
                    </span>
                    {botId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void pin(version.revision)}
                      >
                        <Trans>Use for agent</Trans>
                      </Button>
                    ) : null}
                    {version.revision !== skill?.revision ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void save(version.revision)}
                      >
                        <Trans>Restore</Trans>
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">
                        <Trans>Current</Trans>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        ) : null}
      </div>
    </Disclosure>
  );
}
