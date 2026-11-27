import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@mycellios/chat-ui/web";
import { isDeletableMemoryDocument } from "@mycellios/contracts";
import { Badge, Button, Textarea } from "@mycellios/ui-web";
import { ArrowLeft, Download, FilePlus2, Pencil, Pin, Trash2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from "react";
import {
  type LinkResolver,
  MEMORY_NEW_NOTE_MENTION,
  MEMORY_NOTE_MENTION,
  noteFolder,
  noteTitle,
  type VaultNote,
  wikiLinksAsMentions,
} from "../../lib/memory-vault";

const SUGGESTION_LIMIT = 8;

/** The `[[partial` the caret is completing, if any. */
function openLinkQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /\[\[([^[\]\n|#]{0,80})$/.exec(before);
  return match ? { start: caret - match[1]!.length, query: match[1]! } : null;
}

export type MemoryNoteProps = {
  note: VaultNote;
  locationLabel: string;
  notes: readonly VaultNote[];
  resolve: LinkResolver;
  backlinks: readonly VaultNote[];
  outgoing: readonly VaultNote[];
  editing: boolean;
  draft: string;
  busy: boolean;
  error: string | null;
  conflicted: boolean;
  confirmingDelete: boolean;
  onDraft: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onToggleEssential: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onOpenNote: (id: string) => void;
  onCreateFromLink: (target: string) => void;
  onBack?: () => void;
};

/** One memory note: read view with clickable links, or an editor that completes `[[links]]`. */
export function MemoryNote(props: MemoryNoteProps) {
  const { t, i18n } = useLingui();
  const { note, notes, resolve } = props;
  const rendered = useMemo(() => wikiLinksAsMentions(note, resolve), [note, resolve]);
  const folder = noteFolder(note.path);
  const renderMention = (id: string, name: string): ReactNode => {
    if (id.startsWith(MEMORY_NOTE_MENTION)) {
      const target = id.slice(MEMORY_NOTE_MENTION.length);
      return (
        <button type="button" className="rk-memory-link" onClick={() => props.onOpenNote(target)}>
          {name}
        </button>
      );
    }
    if (id.startsWith(MEMORY_NEW_NOTE_MENTION)) {
      const target = id.slice(MEMORY_NEW_NOTE_MENTION.length);
      return (
        <button
          type="button"
          className="rk-memory-link rk-memory-link-missing"
          title={t`Create the note ${target}`}
          onClick={() => props.onCreateFromLink(target)}
        >
          {name}
        </button>
      );
    }
    return <span>{name}</span>;
  };

  return (
    <article
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="memory-note"
      aria-label={noteTitle(note.path)}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-6">
        {props.onBack ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Back to notes`}
            onClick={props.onBack}
            className="md:hidden"
          >
            <ArrowLeft aria-hidden />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {props.locationLabel}
            {folder ? ` / ${folder}` : ""}
          </p>
          <h2 className="truncate text-lg font-semibold" dir="auto">
            {noteTitle(note.path)}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {note.inclusion === "essential" ? (
              <Badge variant="secondary">
                <Trans>Always included</Trans>
              </Badge>
            ) : null}
            {note.userControlled ? (
              <Badge variant="outline">
                <Trans>Edited by you</Trans>
              </Badge>
            ) : null}
            <span>
              {t`Updated ${new Date(note.updatedAt).toLocaleDateString(i18n.locale || "en", { day: "numeric", month: "short", year: "numeric" })}`}
            </span>
          </div>
        </div>
        {!props.editing ? (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Always include`}
              title={note.inclusion === "essential" ? t`Always included` : t`Include when relevant`}
              aria-pressed={note.inclusion === "essential"}
              disabled={props.busy}
              onClick={props.onToggleEssential}
            >
              <Pin fill={note.inclusion === "essential" ? "currentColor" : "none"} aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Download`}
              title={t`Download`}
              disabled={props.busy}
              onClick={props.onDownload}
            >
              <Download aria-hidden />
            </Button>
            <Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onEdit}>
              <Pencil aria-hidden />
              <Trans>Edit</Trans>
            </Button>
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {props.error ? (
          <p className="pb-2 text-[13px] text-destructive" role="alert">
            {props.error}
          </p>
        ) : null}
        {props.conflicted ? (
          <p className="pb-2 text-[13px] text-destructive" role="alert">
            <Trans>
              This note changed meanwhile. Copy your text, then reopen the note to edit its latest
              version.
            </Trans>
          </p>
        ) : null}
        {props.editing ? (
          <NoteEditor
            note={note}
            notes={notes}
            draft={props.draft}
            busy={props.busy}
            conflicted={props.conflicted}
            confirmingDelete={props.confirmingDelete}
            onDraft={props.onDraft}
            onCancel={props.onCancel}
            onSave={props.onSave}
            onDelete={props.onDelete}
          />
        ) : note.content.trim() ? (
          <div className="rk-memory-note-body" dir="auto">
            <ChatMarkdown renderMention={renderMention}>{rendered}</ChatMarkdown>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            <Trans>This note is empty.</Trans>
          </p>
        )}
        {!props.editing ? (
          <NoteLinks
            title={t`Linked from`}
            empty={t`No notes link here yet.`}
            notes={props.backlinks}
            onOpen={props.onOpenNote}
          />
        ) : null}
        {!props.editing && props.outgoing.length ? (
          <NoteLinks title={t`Links to`} notes={props.outgoing} onOpen={props.onOpenNote} />
        ) : null}
      </div>
    </article>
  );
}

function NoteLinks({
  title,
  empty,
  notes,
  onOpen,
}: {
  title: string;
  empty?: string;
  notes: readonly VaultNote[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="mt-8 border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>
      {notes.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {notes.map((note) => (
            <li key={note.id}>
              <Button
                variant="outline"
                size="sm"
                className="max-w-64"
                onClick={() => onOpen(note.id)}
              >
                <span className="truncate" dir="auto">
                  {noteTitle(note.path)}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : empty ? (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      ) : null}
    </section>
  );
}

function NoteEditor({
  note,
  notes,
  draft,
  busy,
  conflicted,
  confirmingDelete,
  onDraft,
  onCancel,
  onSave,
  onDelete,
}: {
  note: VaultNote;
  notes: readonly VaultNote[];
  draft: string;
  busy: boolean;
  conflicted: boolean;
  confirmingDelete: boolean;
  onDraft: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const field = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const open = caret === null ? null : openLinkQuery(draft, caret);
  const suggestions = useMemo(() => {
    if (!open || dismissedAt === open.start) return [];
    const query = open.query.toLocaleLowerCase();
    const seen = new Set<string>();
    return notes
      .filter((other) => other.id !== note.id)
      .map((other) => noteTitle(other.path))
      .filter((title) => {
        const key = title.toLocaleLowerCase();
        if (seen.has(key) || !key.includes(query)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          Number(!a.toLocaleLowerCase().startsWith(query)) -
            Number(!b.toLocaleLowerCase().startsWith(query)) || a.localeCompare(b),
      )
      .slice(0, SUGGESTION_LIMIT);
  }, [open, dismissedAt, notes, note.id]);

  function accept(title: string) {
    if (!open || caret === null) return;
    const after = draft.slice(caret);
    const closing = after.startsWith("]]") ? "" : "]]";
    const next = `${draft.slice(0, open.start)}${title}${closing}${after}`;
    const position = open.start + title.length + 2;
    onDraft(next);
    setCaret(position);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(position, position);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      if (!busy && !conflicted && draft !== note.content) onSave();
      return;
    }
    if (!suggestions.length || !open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(
        (index) =>
          (index + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length,
      );
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      accept(suggestions[Math.min(active, suggestions.length - 1)]!);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedAt(open.start);
    }
  }

  const syncCaret = () => setCaret(field.current?.selectionStart ?? null);
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        <Trans>Write [[ to link another note.</Trans>
      </p>
      <div className="relative">
        <Textarea
          ref={field}
          aria-label={noteTitle(note.path)}
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          disabled={busy}
          value={draft}
          autoFocus
          onChange={(event) => {
            onDraft(event.target.value);
            setCaret(event.target.selectionStart);
            setActive(0);
          }}
          onSelect={syncCaret}
          onClick={syncCaret}
          onKeyDown={onKeyDown}
          onBlur={() => setCaret(null)}
          rows={Math.min(28, Math.max(8, draft.split("\n").length + 2))}
          className="w-full font-mono text-[13px] leading-relaxed"
          dir="auto"
        />
        {suggestions.length ? (
          <div
            role="listbox"
            aria-label={t`Notes to link`}
            className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {suggestions.map((title, index) => (
              <button
                key={title}
                type="button"
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className={`block w-full truncate rounded-md px-2 py-1.5 text-start text-sm ${index === active ? "bg-accent text-accent-foreground" : ""}`}
                // Keep the textarea focused so the caret stays where the link is written.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(title)}
                dir="auto"
              >
                {title}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || conflicted || draft === note.content} onClick={onSave}>
          <Trans>Save</Trans>
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        {isDeletableMemoryDocument(note.path) ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onDelete}
            className="ms-auto text-destructive"
          >
            <Trash2 aria-hidden />
            {confirmingDelete ? <Trans>Confirm delete</Trans> : <Trans>Delete</Trans>}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyMemoryNote({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">
        <Trans>Pick a note to read it, or open the graph to see how your notes connect.</Trans>
      </p>
      <Button variant="secondary" size="sm" onClick={onCreate}>
        <FilePlus2 aria-hidden />
        <Trans>New note</Trans>
      </Button>
    </div>
  );
}
