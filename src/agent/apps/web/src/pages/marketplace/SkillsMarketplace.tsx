import { Trans, useLingui } from "@lingui/react/macro";
import type { AgentSkill, AgentSkillCatalogEntry, Bot } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ChartNoAxesColumn,
  Code2,
  FileText,
  Palette,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchFresh, useSpaceQueries } from "../../lib/query";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";
import { groupByCategory, matches, type Recipe, recipeContent, SKILL_RECIPES } from "./catalog";
import { CategoryName } from "./parts";

export function SkillsMarketplace({ bots }: { bots: Bot[] }) {
  const { t } = useLingui();
  const client = useSpaceRpc();
  const queries = useSpaceQueries();
  const cache = useQueryClient();
  const listOptions = queries.agentSkills.list.queryOptions();
  const list = useQuery({ ...listOptions, refetchOnMount: "always" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<{ skill: AgentSkill | null; content: string } | null>(null);
  const [history, setHistory] = useState<AgentSkill[]>([]);
  const [botId, setBotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      ++generation.current;
    },
    [],
  );
  const saved = list.data ?? [];
  async function refresh() {
    await fetchFresh(cache, listOptions);
  }
  async function open(entry: AgentSkillCatalogEntry) {
    const epoch = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    setDeleting(false);
    try {
      const skill = await client.agentSkills.get({ skillId: entry.id });
      const versions = skill.readOnly
        ? []
        : await client.agentSkills.history({ skillId: skill.id });
      if (epoch !== generation.current) return;
      setEditor({ skill, content: skill.content });
      setHistory(versions);
    } catch (cause) {
      if (epoch === generation.current) setError(errorText(cause, t`Could not load skill`));
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  async function mutate(action: () => Promise<void>) {
    if (busy) return;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      if (epoch === generation.current) setError(errorText(cause, t`Could not save skill`));
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  async function save(revision?: number) {
    if (!editor) return;
    const current = editor;
    await mutate(async () => {
      const skill = current.skill
        ? revision === undefined
          ? await client.agentSkills.update({
              skillId: current.skill.id,
              expectedRevision: current.skill.revision,
              content: current.content,
            })
          : await client.agentSkills.restore({
              skillId: current.skill.id,
              expectedRevision: current.skill.revision,
              revision,
            })
        : await client.agentSkills.create({ content: current.content });
      setEditor({ skill, content: skill.content });
      setHistory(await client.agentSkills.history({ skillId: skill.id }));
      setDeleting(false);
      setNotice(t`Saved`);
      await refresh();
    });
  }
  async function install(recipe: Recipe) {
    const existing = saved.find((skill) => skill.name.toLowerCase() === recipe.name.toLowerCase());
    if (existing) {
      await open(existing);
      return;
    }
    // Preview before saving: shared skills become available to Micos in this Space.
    ++generation.current;
    setHistory([]);
    setDeleting(false);
    setError("");
    setNotice("");
    setEditor({ skill: null, content: recipeContent(recipe) });
  }
  async function pin(revision: number | null) {
    if (!editor?.skill || !botId) return;
    const skill = editor.skill;
    await mutate(async () => {
      await client.agentSkills.pin({ skillId: skill.id, botId, revision });
      setNotice(
        revision === null ? t`Agent follows the latest version` : t`Version saved for this agent`,
      );
    });
  }
  async function remove() {
    if (!editor?.skill || editor.skill.readOnly) return;
    if (!deleting) {
      setDeleting(true);
      return;
    }
    const skill = editor.skill;
    await mutate(async () => {
      await client.agentSkills.remove({ skillId: skill.id });
      setEditor(null);
      setHistory([]);
      await refresh();
    });
  }
  const visibleSaved = saved.filter(
    (skill) =>
      matches(query, skill.name, skill.description) &&
      (filter !== "yours" || skill.source === "user") &&
      (filter !== "catalog" || skill.source !== "user"),
  );
  const recipes =
    filter === "yours"
      ? []
      : SKILL_RECIPES.filter(
          (recipe) =>
            matches(query, recipe.name, recipe.description) &&
            !saved.some((skill) => skill.name.toLowerCase() === recipe.name.toLowerCase()),
        );
  const icons = {
    code: Code2,
    design: Palette,
    data: ChartNoAxesColumn,
    documents: FileText,
    productivity: Sparkles,
    other: BookOpen,
  };
  return (
    <section data-testid="marketplace-skills">
      <div className="rk-market-heading">
        <div>
          <h1>
            <Trans>Skills</Trans>
          </h1>
          <p>
            <Trans>Instructions that teach a Mico a task or a tool.</Trans>
          </p>
        </div>
        <fieldset className="rk-market-segments" aria-label={t`Skill source`}>
          {[
            ["all", t`All entries`],
            ["catalog", t`Catalog`],
            ["yours", t`Personal entries`],
          ].map(([value, label]) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={filter === value}
              onClick={() => setFilter(value!)}
            >
              {label}
            </Button>
          ))}
        </fieldset>
      </div>
      <div className="rk-market-search">
        <div className="rk-market-search-field">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label={t`Search skills`}
            placeholder={t`Search`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            ++generation.current;
            setEditor({
              skill: null,
              content:
                "---\nname: my-skill\ndescription: Describe when to use this skill.\n---\n\n",
            });
            setHistory([]);
            setDeleting(false);
            setError("");
            setNotice("");
          }}
        >
          <Plus size={14} />
          <Trans>Create skill</Trans>
        </Button>
      </div>
      {list.isPending ? (
        <p role="status">
          <Trans>Loading…</Trans>
        </p>
      ) : null}
      {list.isError ? (
        <div role="alert" className="rk-market-error">
          <Trans>Could not load skills</Trans>
          <Button variant="ghost" onClick={() => void list.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
      {error && !editor ? (
        <p role="alert" className="rk-market-error">
          {error}
        </p>
      ) : null}
      <section className="rk-market-group">
        <h2>
          <Trans>Your skills</Trans>
          <span>{visibleSaved.length}</span>
        </h2>
        {visibleSaved.length ? (
          <div className="rk-market-rows">
            {visibleSaved.map((skill) => (
              <div className="rk-market-row" key={skill.id}>
                <span className="rk-market-skill-mark">
                  <BookOpen size={21} />
                </span>
                <button
                  type="button"
                  className="rk-market-row-copy"
                  disabled={busy}
                  onClick={() => void open(skill)}
                >
                  <strong>{skill.name}</strong>
                  <span>{skill.description}</span>
                </button>
                <Button variant="secondary" disabled={busy} onClick={() => void open(skill)}>
                  <Trans>Open</Trans>
                </Button>
              </div>
            ))}
          </div>
        ) : !list.isPending && !list.isError ? (
          <div className="rk-market-empty">
            <Sparkles size={24} />
            <div>
              <Trans>No skills match this view yet.</Trans>
              <p>
                <Trans>
                  Add one below or create your own. Shared skills are available in this Space.
                </Trans>
              </p>
            </div>
          </div>
        ) : null}
      </section>
      {groupByCategory(recipes, (recipe) => recipe.category).map((group) => {
        const Icon = icons[group.id];
        return (
          <section className="rk-market-group" key={group.id}>
            <h2>
              <CategoryName category={group.id} />
              <span>{group.items.length}</span>
            </h2>
            <div className="rk-market-rows">
              {group.items.map((recipe) => {
                const installed = saved.some(
                  (skill) => skill.name.toLowerCase() === recipe.name.toLowerCase(),
                );
                return (
                  <div className="rk-market-row" key={recipe.id}>
                    <span className="rk-market-skill-mark" data-category={group.id}>
                      <Icon size={21} />
                    </span>
                    <button
                      type="button"
                      className="rk-market-row-copy"
                      onClick={() => void install(recipe)}
                      disabled={busy}
                    >
                      <strong>{recipe.name}</strong>
                      <span>{recipe.description}</span>
                    </button>
                    <Button
                      variant="outline"
                      disabled={busy || list.isPending || list.isError}
                      onClick={() => void install(recipe)}
                    >
                      {installed ? (
                        <Trans>Open</Trans>
                      ) : (
                        <>
                          <Plus size={14} />
                          <Trans>Add</Trans>
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            ++generation.current;
            setEditor(null);
            setHistory([]);
            setError("");
          }
        }}
      >
        <DialogContent
          className="rk-scroll max-h-[90dvh] overflow-y-auto sm:max-w-[760px]"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>{editor?.skill?.name ?? t`Create skill`}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <Trans>Skills are shared in this Space. Version pins apply to the selected Mico.</Trans>
          </p>
          <Textarea
            aria-label="SKILL.md"
            rows={12}
            maxLength={100000}
            disabled={busy}
            readOnly={editor?.skill?.readOnly}
            value={editor?.content ?? ""}
            onChange={(event) =>
              setEditor((current) =>
                current ? { ...current, content: event.target.value } : current,
              )
            }
          />
          <div className="flex flex-wrap gap-2">
            {!editor?.skill?.readOnly ? (
              <Button
                disabled={
                  busy || !editor?.content.trim() || editor.content === editor.skill?.content
                }
                onClick={() => void save()}
              >
                <Trans>Save</Trans>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                ++generation.current;
                setEditor(null);
                setError("");
              }}
            >
              <Trans>Close</Trans>
            </Button>
            {editor?.skill && !editor.skill.readOnly ? (
              <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
                {deleting ? <Trans>Confirm delete</Trans> : <Trans>Delete</Trans>}
              </Button>
            ) : null}
          </div>
          {editor?.skill && !editor.skill.readOnly ? (
            <>
              <label className="text-sm" htmlFor="marketplace-skill-mico">
                <Trans>Skill version for an agent</Trans>
              </label>
              <NativeSelect
                id="marketplace-skill-mico"
                value={botId}
                disabled={busy}
                onChange={(event) => setBotId(event.target.value)}
              >
                <NativeSelectOption value="">{t`Choose an agent`}</NativeSelectOption>
                {bots.map((bot) => (
                  <NativeSelectOption key={bot.id} value={bot.id}>
                    {bot.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy || !botId}
                  onClick={() => void pin(editor.skill!.revision)}
                >
                  <Trans>Use current version</Trans>
                </Button>
                <Button variant="ghost" disabled={busy || !botId} onClick={() => void pin(null)}>
                  <Trans>Follow latest</Trans>
                </Button>
              </div>
              <ol className="space-y-2" aria-label={t`Version history`}>
                {history.map((version) => (
                  <li key={version.revision} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>
                      <Trans>Version {version.revision}</Trans> ·{" "}
                      {new Date(version.updatedAt).toLocaleString()}
                    </span>
                    {botId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void pin(version.revision)}
                      >
                        <Trans>Use for agent</Trans>
                      </Button>
                    ) : null}
                    {version.revision !== editor.skill?.revision ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void save(version.revision)}
                      >
                        <Trans>Restore</Trans>
                      </Button>
                    ) : (
                      <Trans>Current</Trans>
                    )}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rk-market-error">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p role="status">
              <Trans>Loading…</Trans>
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
