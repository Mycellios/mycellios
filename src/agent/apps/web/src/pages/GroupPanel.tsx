import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, Group } from "@mycellios/contracts";
import {
  GROUP_MEMBER_MAX,
  GROUP_MEMBER_MIN,
  GROUP_NAME_MAX_LENGTH,
  GROUP_PURPOSE_MAX_LENGTH,
} from "@mycellios/contracts";
import { BotAvatar, Button, Checkbox, Input, NativeSelect, Textarea } from "@mycellios/ui-web";
import { X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { errorText } from "../lib/user-error";
import { DeleteItemDialog } from "./shell/dialogs";

function validSelection(name: string, selected: readonly string[]) {
  return (
    Boolean(name.trim()) &&
    selected.length >= GROUP_MEMBER_MIN &&
    selected.length <= GROUP_MEMBER_MAX
  );
}

function sameMembers(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

/** The lead after an edit: the chosen one while it is still selected, else the first member. */
function leadAmong(selected: readonly string[], lead: string | null | undefined): string | undefined {
  return lead && selected.includes(lead) ? lead : selected[0];
}

/**
 * What the group is for and which member takes messages that name nobody. The lead is the
 * person's choice; routing never asks a model.
 */
function PurposeAndLead({
  bots,
  selected,
  purpose,
  onPurpose,
  lead,
  onLead,
}: {
  bots: Bot[];
  selected: readonly string[];
  purpose: string;
  onPurpose: (value: string) => void;
  lead: string | undefined;
  onLead: (botId: string) => void;
}) {
  const { t } = useLingui();
  const purposeId = useId();
  const leadId = useId();
  const members = selected
    .map((id) => bots.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => Boolean(bot));
  return (
    <>
      <label htmlFor={purposeId} className="mt-4 block text-sm text-muted-foreground">
        <Trans>Purpose</Trans>
        <Textarea
          id={purposeId}
          value={purpose}
          onChange={(event) => onPurpose(event.target.value)}
          placeholder={t`What is this group for?`}
          maxLength={GROUP_PURPOSE_MAX_LENGTH}
          rows={2}
          className="mt-2"
        />
      </label>
      {members.length ? (
        <label htmlFor={leadId} className="mt-4 block text-sm text-muted-foreground">
          <Trans>Lead</Trans>
          <NativeSelect
            id={leadId}
            value={lead ?? ""}
            onChange={(event) => onLead(event.target.value)}
            className="mt-2 w-full"
          >
            {members.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </NativeSelect>
          <span className="mt-1 block text-xs">
            <Trans>Takes the messages that name no member, and hands them on when another member fits better.</Trans>
          </span>
        </label>
      ) : null}
    </>
  );
}

function MemberPicker({
  bots,
  selected,
  onChange,
  onShowBot,
  initiallyExpanded = false,
}: {
  bots: Bot[];
  selected: string[];
  onChange: (selected: string[]) => void;
  onShowBot?: (botId: string) => void;
  initiallyExpanded?: boolean;
}) {
  const { t } = useLingui();
  const listId = useId();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [query, setQuery] = useState("");
  // Every bot ever picked this session stays listed when collapsed, so an
  // unchecked member remains re-checkable until the form is saved.
  const [everPicked, setEverPicked] = useState<ReadonlySet<string>>(() => new Set(selected));
  const selectable = useMemo(() => bots.filter((bot) => !bot.archivedAt), [bots]);
  // The filter field only exists in the expanded view; never let a stale
  // query hide members when the list is collapsed.
  const needle = expanded ? query.trim().toLowerCase() : "";
  const visible = useMemo(() => {
    const base = expanded ? selectable : selectable.filter((bot) => everPicked.has(bot.id));
    if (!needle) return base;
    return base.filter(
      (bot) => bot.name.toLowerCase().includes(needle) || bot.title.toLowerCase().includes(needle),
    );
  }, [expanded, selectable, everPicked, needle]);

  function toggle(botId: string) {
    if (selected.includes(botId)) {
      onChange(selected.filter((id) => id !== botId));
    } else if (selected.length < GROUP_MEMBER_MAX) {
      setEverPicked((current) => new Set(current).add(botId));
      onChange([...selected, botId]);
    }
  }

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          <Trans>Members ({selected.length})</Trans>
        </span>
        <Button
          variant="text"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          className="font-normal"
        >
          {expanded ? <Trans>Show selected</Trans> : <Trans>Show all</Trans>}
        </Button>
      </div>
      {expanded ? (
        <>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t`Filter bots`}
            aria-label={t`Filter bots`}
            className="mt-2"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans>
              Pick {GROUP_MEMBER_MIN}–{GROUP_MEMBER_MAX}
            </Trans>
          </p>
        </>
      ) : null}
      <div id={listId} className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {visible.map((bot) => {
          const checked = selected.includes(bot.id);
          return (
            <div
              key={bot.id}
              className={`flex w-full items-center rounded-xl px-2.5 py-2.5 ${
                checked ? "bg-accent" : "hover:bg-accent"
              }`}
            >
              <button
                type="button"
                onClick={() => onShowBot?.(bot.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-start"
              >
                <BotAvatar color={bot.color} identity={bot.id} size={32} status={bot.status} />
                <span className="flex-1 text-[15px] text-foreground" dir="auto">
                  {bot.name}
                </span>
              </button>
              <Checkbox
                checked={checked}
                aria-label={
                  checked ? t`Remove ${bot.name} from the group` : t`Add ${bot.name} to the group`
                }
                onCheckedChange={() => toggle(bot.id)}
              />
            </div>
          );
        })}
        {visible.length === 0 ? (
          <p className="px-2.5 py-2.5 text-sm text-muted-foreground">
            {expanded ? <Trans>No bots match</Trans> : <Trans>No members yet</Trans>}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CreateGroupForm({
  bots,
  onCancel,
  onCreate,
  onShowBot,
}: {
  bots: Bot[];
  onCancel: () => void;
  onCreate: (input: { name: string; botIds: string[]; purpose?: string; leadBotId?: string }) => Promise<void>;
  onShowBot?: (botId: string) => void;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [purpose, setPurpose] = useState("");
  const [chosenLead, setChosenLead] = useState<string | undefined>();
  const lead = leadAmong(selected, chosenLead);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (submitting || !validSelection(name, selected)) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        botIds: selected,
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
        ...(lead ? { leadBotId: lead } : {}),
      });
    } catch (cause) {
      setError(errorText(cause, t`Could not create group`));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          <Trans>New group</Trans>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Cancel new group`}
          onClick={onCancel}
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <label htmlFor={nameId} className="block text-sm text-muted-foreground">
        <Trans>Name</Trans>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t`Name this group`}
          maxLength={GROUP_NAME_MAX_LENGTH}
          className="mt-2"
        />
      </label>
      <MemberPicker
        bots={bots}
        selected={selected}
        onChange={setSelected}
        onShowBot={onShowBot}
        initiallyExpanded
      />
      <PurposeAndLead
        bots={bots}
        selected={selected}
        purpose={purpose}
        onPurpose={setPurpose}
        lead={lead}
        onLead={setChosenLead}
      />
      <Button
        className="mt-5 w-full"
        disabled={submitting || !validSelection(name, selected)}
        onClick={() => void create()}
      >
        {submitting ? <Trans>Creating…</Trans> : <Trans>Create group</Trans>}
      </Button>
    </div>
  );
}

export function GroupSettings({
  group,
  bots,
  onSave,
  onRemove,
  onClose,
  onShowBot,
  covered = false,
}: {
  group: Group;
  bots: Bot[];
  onSave: (input: {
    name?: string;
    botIds?: string[];
    purpose?: string;
    leadBotId?: string | null;
  }) => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
  onShowBot?: (botId: string) => void;
  /** A full-screen overlay is on top, so Escape belongs to it. */
  covered?: boolean;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState(group.name);
  const [selected, setSelected] = useState(group.members.map((member) => member.botId));
  const [purpose, setPurpose] = useState(group.purpose ?? "");
  const [chosenLead, setChosenLead] = useState<string | undefined>(group.leadBotId ?? undefined);
  const lead = leadAmong(selected, chosenLead);
  const savedLead = leadAmong(
    group.members.map((member) => member.botId),
    group.leadBotId,
  );
  // The panel can open on a cached group. A refreshed one replaces whatever was not edited, so a
  // save does not send the cached name or members back as a change.
  const [shownGroup, setShownGroup] = useState(group);
  if (group !== shownGroup) {
    setShownGroup(group);
    if (name === shownGroup.name) setName(group.name);
    const shownMembers = shownGroup.members.map((member) => member.botId);
    if (sameMembers(selected, shownMembers)) {
      setSelected(group.members.map((member) => member.botId));
    }
    if (purpose === (shownGroup.purpose ?? "")) setPurpose(group.purpose ?? "");
    if (chosenLead === (shownGroup.leadBotId ?? undefined)) setChosenLead(group.leadBotId ?? undefined);
  }
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Closing while a save is in flight would let its completion close the panel
  // again after a reopen. While the delete confirmation or an overlay is open,
  // Escape belongs to it.
  useEffect(() => {
    if (saving || confirmingDelete || covered) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, confirmingDelete, covered, onClose]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim() !== group.name ? name.trim() : undefined,
        botIds: sameMembers(
          selected,
          group.members.map((member) => member.botId),
        )
          ? undefined
          : selected,
        purpose: purpose.trim() !== (group.purpose ?? "") ? purpose.trim() : undefined,
        leadBotId: lead !== savedLead ? (lead ?? null) : undefined,
      });
    } catch (cause) {
      setError(errorText(cause, t`Could not save group`));
      return;
    } finally {
      setSaving(false);
    }
    // A save that finishes after the user switched chats must not close
    // whatever panel is open there.
    if (mounted.current) onClose();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          <Trans>Group settings</Trans>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Close panel`}
          disabled={saving}
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.8} />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <label htmlFor={nameId} className="block text-sm text-muted-foreground">
        <Trans>Name</Trans>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={GROUP_NAME_MAX_LENGTH}
          className="mt-2"
        />
      </label>
      <MemberPicker bots={bots} selected={selected} onChange={setSelected} onShowBot={onShowBot} />
      <PurposeAndLead
        bots={bots}
        selected={selected}
        purpose={purpose}
        onPurpose={setPurpose}
        lead={lead}
        onLead={setChosenLead}
      />
      <Button
        className="mt-5 w-full"
        disabled={saving || !validSelection(name, selected)}
        onClick={() => void save()}
      >
        {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
      </Button>
      <Button
        variant="destructive"
        className="mt-4 w-full"
        disabled={saving}
        onClick={() => setConfirmingDelete(true)}
      >
        <Trans>Delete group</Trans>
      </Button>
      {confirmingDelete ? (
        <DeleteItemDialog
          item={group}
          noun="group"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={onRemove}
        />
      ) : null}
    </div>
  );
}

export function memberName(
  members: Group["members"] | undefined,
  botId: string | undefined,
): string | undefined {
  if (!botId || !members) return undefined;
  return members.find((member) => member.botId === botId)?.name;
}
