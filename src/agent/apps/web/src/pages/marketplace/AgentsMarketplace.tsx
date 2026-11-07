import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import {
  BOT_AVATAR_COLORS,
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@rakazo/ui-web";
import { Pin, Plus, Search } from "lucide-react";
import { useRef, useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";
import { groupByCategory, MICO_TEMPLATES, matches, templateInstructions } from "./catalog";
import { CategoryName } from "./parts";

export function AgentsMarketplace({
  bots,
  scope,
  onCreated,
  onOpen,
  onChanged,
  onCreate,
}: {
  bots: Bot[];
  scope: string;
  onCreated: (bot: Bot) => void;
  onOpen: (id: string) => void;
  onChanged: () => Promise<void>;
  onCreate: () => void;
}) {
  const { t } = useLingui();
  const client = useSpaceRpc();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<(typeof MICO_TEMPLATES)[number] | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nonces = useRef(new Map<string, string>());
  const look = (template: (typeof MICO_TEMPLATES)[number]) => ({
    color: BOT_AVATAR_COLORS[MICO_TEMPLATES.indexOf(template) % BOT_AVATAR_COLORS.length]!,
    identity: `marketplace:${template.id}`,
  });
  async function create() {
    if (!selected || busy || !name.trim()) return;
    setBusy(true);
    setError("");
    const template = selected;
    const key = `mycellios:marketplace-create:${scope}:${template.id}`;
    let nonce = nonces.current.get(key);
    try {
      nonce ??= sessionStorage.getItem(key) ?? undefined;
    } catch {
      /* Retain in-memory retry key. */
    }
    nonce ??= crypto.randomUUID();
    nonces.current.set(key, nonce);
    try {
      sessionStorage.setItem(key, nonce);
    } catch {
      /* Storage can be unavailable. */
    }
    try {
      const bot = await client.bots.create({
        name: name.trim(),
        description: template.description,
        title: template.description,
        instructions,
        notifyOnFinish: true,
        computerMode: "team",
        spawnKey: `marketplace:${nonce}`,
      });
      nonces.current.delete(key);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* No secret is stored here. */
      }
      onCreated(bot);
    } catch (cause) {
      setError(errorText(cause, t`Could not create Mico`));
    } finally {
      setBusy(false);
    }
  }
  async function pin(bot: Bot) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await client.bots.update({ botId: bot.id, pinned: !bot.pinned });
      await onChanged();
    } catch (cause) {
      setError(errorText(cause, t`Could not save pin`));
    } finally {
      setBusy(false);
    }
  }
  function preview(template: (typeof MICO_TEMPLATES)[number]) {
    setSelected(template);
    setName(template.name);
    setInstructions(templateInstructions(template));
    setError("");
  }
  const templates =
    filter === "yours"
      ? []
      : MICO_TEMPLATES.filter((item) => matches(query, item.name, item.description));
  const yours =
    filter === "catalog"
      ? []
      : bots.filter(
          (bot) =>
            matches(query, bot.name, bot.title ?? "", bot.description ?? "") &&
            (filter === "yours" || query.trim() || bot.pinned),
        );
  function row(template: (typeof MICO_TEMPLATES)[number], featured = false) {
    return (
      <div key={template.id} className={featured ? "rk-market-featured-card" : "rk-market-row"}>
        <BotAvatar
          identity={look(template).identity}
          color={look(template).color}
          size={featured ? 48 : 40}
        />
        <button
          type="button"
          className="rk-market-row-copy"
          onClick={() => preview(template)}
          disabled={busy}
        >
          <strong>
            {template.name}
            {!featured ? <small> · Mycellios</small> : null}
          </strong>
          {featured ? <small>Mycellios</small> : null}
          <span>{template.description}</span>
          {featured ? (
            <small>
              <Trans>{template.skills.length} included guides</Trans>
            </small>
          ) : null}
        </button>
        <Button variant="secondary" onClick={() => preview(template)} disabled={busy}>
          <Plus size={14} />
          <Trans>Add</Trans>
        </Button>
      </div>
    );
  }
  return (
    <section data-testid="marketplace-agents">
      <div className="rk-market-heading">
        <div>
          <h1>
            <Trans>Micos</Trans>
          </h1>
          <p>
            <Trans>Ready-to-use Micos with their own instructions and guides.</Trans>
          </p>
        </div>
        <fieldset className="rk-market-segments" aria-label={t`Mico source`}>
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t`Search Micos`}
            placeholder={t`Search`}
          />
        </div>
        <Button variant="outline" disabled={busy} onClick={onCreate}>
          <Plus size={14} />
          <Trans>Create Mico</Trans>
        </Button>
      </div>
      {error && !selected ? (
        <p role="alert" className="rk-market-error">
          {error}
        </p>
      ) : null}
      {filter !== "catalog" ? (
        <section className="rk-market-group">
          <h2>
            <Trans>Your Micos</Trans>
            <Button variant="ghost" size="sm" onClick={() => setFilter("yours")}>
              <Trans>View all</Trans>
            </Button>
          </h2>
          {yours.length ? (
            <div className="rk-market-rows">
              {yours.map((bot) => (
                <div className="rk-market-row" key={bot.id}>
                  <BotAvatar identity={bot.id} color={bot.color} size={40} />
                  <button
                    type="button"
                    className="rk-market-row-copy"
                    onClick={() => onOpen(bot.id)}
                  >
                    <strong>{bot.name}</strong>
                    <span>{bot.title || bot.description}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={bot.pinned ? t`Unpin ${bot.name}` : t`Pin ${bot.name}`}
                    aria-pressed={bot.pinned}
                    onClick={() => void pin(bot)}
                  >
                    <Pin size={16} fill={bot.pinned ? "currentColor" : "none"} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rk-market-empty">
              <Trans>No Micos match this view.</Trans>
            </p>
          )}
        </section>
      ) : null}
      {templates.length && !query.trim() ? (
        <section className="rk-market-group">
          <h2>
            <Trans>Featured</Trans>
          </h2>
          <div className="rk-market-featured">
            {templates.slice(0, 3).map((template) => row(template, true))}
          </div>
        </section>
      ) : null}
      {groupByCategory(templates, (template) => template.category).map((group) => (
        <section className="rk-market-group" key={group.id}>
          <h2>
            <CategoryName category={group.id} />
          </h2>
          <div className="rk-market-rows">{group.items.map((template) => row(template))}</div>
        </section>
      ))}
      {!templates.length && filter !== "yours" ? (
        <p className="rk-market-empty">
          <Trans>No results</Trans>
        </p>
      ) : null}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <DialogContent
          className="rk-scroll max-h-[90dvh] overflow-y-auto sm:max-w-[700px]"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
          </DialogHeader>
          <label htmlFor="marketplace-mico-name">
            <Trans>Name</Trans>
          </label>
          <Input
            id="marketplace-mico-name"
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <label htmlFor="marketplace-mico-instructions">
            <Trans>Instructions</Trans>
          </label>
          <Textarea
            id="marketplace-mico-instructions"
            rows={12}
            value={instructions}
            maxLength={20000}
            disabled={busy}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            <Trans>
              The included guides become this Mico's instructions. Creating it does not start a task
              or connect an app.
            </Trans>
          </p>
          {error ? (
            <p className="rk-market-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button disabled={busy || !name.trim()} onClick={() => void create()}>
              {busy ? <Trans>Creating…</Trans> : <Trans>Add Mico</Trans>}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
