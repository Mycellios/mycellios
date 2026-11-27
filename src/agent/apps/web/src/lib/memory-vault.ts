import { markdownMentionHref } from "@mycellios/chat-ui/web";
import type { MemoryDocument } from "@mycellios/contracts";

/**
 * The memory page reads the person's own notes as a vault: `[[links]]` between notes,
 * backlinks and a graph. Everything here is derived from the note text in the browser;
 * nothing is stored and nothing reaches a Mico's prompt.
 */

export type VaultNote = Pick<
  MemoryDocument,
  | "id"
  | "scope"
  | "botId"
  | "path"
  | "content"
  | "revision"
  | "updatedAt"
  | "inclusion"
  | "userControlled"
  | "taskThreadId"
> & { taskThreadTitle?: string | null };

export type WikiLink = {
  /** The target as written, without alias or heading. */
  target: string;
  heading?: string;
  alias?: string;
  /** Offsets of the whole `[[...]]` in the source text. */
  start: number;
  end: number;
};

export type ResolvedLink = WikiLink & { noteId: string | null };

export type VaultGroup = { kind: "general" } | { kind: "mico"; botId: string };

export type VaultGraphNode = {
  id: string;
  label: string;
  /** "general", a Mico id, or "ghost" for a link to a note that does not exist. */
  group: string;
  ghost: boolean;
  essential: boolean;
  degree: number;
};

export type VaultGraphEdge = { source: string; target: string };

export type VaultGraph = {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
  /** Outgoing resolved links per note id (unique targets). */
  outgoing: Map<string, string[]>;
  /** Incoming links per note id (unique sources). */
  backlinks: Map<string, string[]>;
};

export const GHOST_PREFIX = "ghost:";
const MAX_LINKS_PER_NOTE = 500;
const MAX_TARGET_LENGTH = 200;

/** The note's name: its file name without `.md`, as notes apps show it. */
export function noteTitle(path: string): string {
  const name = path.split("/").filter(Boolean).at(-1) ?? path;
  return name.replace(/\.md$/i, "") || path;
}

export function noteFolder(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

/** Case- and extension-insensitive key used to match a link with a note. */
export function linkKey(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "")
    .normalize("NFC")
    .toLocaleLowerCase("und");
}

/** Code spans and fenced blocks hold literal text, never links. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fence = /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1\2[ \t]*$|(?![\s\S]))/gm;
  for (const match of text.matchAll(fence))
    ranges.push([match.index, match.index + match[0].length]);
  const inline = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
  for (const match of text.matchAll(inline)) {
    const start = match.index;
    if (!ranges.some(([from, to]) => start >= from && start < to))
      ranges.push([start, start + match[0].length]);
  }
  return ranges;
}

/** Every `[[target#heading|alias]]` outside code, in order. */
export function parseWikiLinks(text: string): WikiLink[] {
  const code = codeRanges(text);
  const links: WikiLink[] = [];
  for (const match of text.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
    if (links.length >= MAX_LINKS_PER_NOTE) break;
    const start = match.index;
    if (code.some(([from, to]) => start >= from && start < to)) continue;
    const [inner, alias] = splitOnce(match[2]!, "|");
    const [rawTarget, heading] = splitOnce(inner, "#");
    const target = rawTarget.trim();
    if (!target || target.length > MAX_TARGET_LENGTH) continue;
    links.push({
      target,
      ...(heading?.trim() ? { heading: heading.trim() } : {}),
      ...(alias?.trim() ? { alias: alias.trim() } : {}),
      start,
      end: start + match[0].length,
    });
  }
  return links;
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  return index < 0 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)];
}

export function vaultGroupKey(note: Pick<VaultNote, "scope" | "botId">): string {
  return note.scope === "user" || !note.botId ? "general" : note.botId;
}

export type LinkResolver = (
  from: Pick<VaultNote, "scope" | "botId">,
  target: string,
) => string | null;

/**
 * Resolves a link the way the person expects inside their own vault: a note in the same
 * Mico (or General) first, then General, then any note when exactly one matches. Paths
 * match before titles. An ambiguous or missing target stays unresolved.
 */
export function createLinkResolver(notes: readonly VaultNote[]): LinkResolver {
  const byPath = new Map<string, VaultNote[]>();
  const byTitle = new Map<string, VaultNote[]>();
  const add = (map: Map<string, VaultNote[]>, key: string, note: VaultNote) => {
    const list = map.get(key);
    if (list) list.push(note);
    else map.set(key, [note]);
  };
  // A task conversation's notes can link out, but a link never lands on them: they are
  // scratch notes for one conversation and would make ordinary names ambiguous.
  for (const note of notes) {
    if (note.taskThreadId) continue;
    add(byPath, linkKey(note.path), note);
    add(byTitle, linkKey(noteTitle(note.path)), note);
  }
  const pick = (candidates: VaultNote[] | undefined, from: Pick<VaultNote, "scope" | "botId">) => {
    if (!candidates?.length) return null;
    const group = vaultGroupKey(from);
    const sameGroup = candidates.filter((note) => vaultGroupKey(note) === group);
    if (sameGroup.length === 1) return sameGroup[0]!.id;
    if (sameGroup.length > 1) return null;
    const general = candidates.filter((note) => vaultGroupKey(note) === "general");
    if (general.length === 1) return general[0]!.id;
    if (general.length > 1) return null;
    return candidates.length === 1 ? candidates[0]!.id : null;
  };
  return (from, target) => {
    const key = linkKey(target);
    if (!key) return null;
    return pick(byPath.get(key), from) ?? (key.includes("/") ? null : pick(byTitle.get(key), from));
  };
}

export function resolveNoteLinks(note: VaultNote, resolve: LinkResolver): ResolvedLink[] {
  return parseWikiLinks(note.content).map((link) => ({
    ...link,
    noteId: resolve(note, link.target),
  }));
}

export function buildVaultGraph(notes: readonly VaultNote[]): VaultGraph {
  const resolve = createLinkResolver(notes);
  const outgoing = new Map<string, string[]>();
  const backlinks = new Map<string, string[]>();
  const ghosts = new Map<string, VaultGraphNode>();
  const edges: VaultGraphEdge[] = [];
  const pairs = new Set<string>();
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const note of notes) {
    const targets: string[] = [];
    for (const link of resolveNoteLinks(note, resolve)) {
      const targetId = link.noteId ?? `${GHOST_PREFIX}${linkKey(link.target)}`;
      if (targetId === note.id || targets.includes(targetId)) continue;
      targets.push(targetId);
      if (!link.noteId && !ghosts.has(targetId))
        ghosts.set(targetId, {
          id: targetId,
          label: noteTitle(link.target),
          group: "ghost",
          ghost: true,
          essential: false,
          degree: 0,
        });
      if (link.noteId) {
        const sources = backlinks.get(link.noteId);
        if (sources) sources.push(note.id);
        else backlinks.set(link.noteId, [note.id]);
      }
      // Two notes linking each other draw one edge.
      const pair = note.id < targetId ? `${note.id}\n${targetId}` : `${targetId}\n${note.id}`;
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      edges.push({ source: note.id, target: targetId });
      bump(note.id);
      bump(targetId);
    }
    if (targets.some((id) => !id.startsWith(GHOST_PREFIX)))
      outgoing.set(
        note.id,
        targets.filter((id) => !id.startsWith(GHOST_PREFIX)),
      );
  }
  const nodes: VaultGraphNode[] = [
    ...notes.map((note) => ({
      id: note.id,
      label: noteTitle(note.path),
      group: vaultGroupKey(note),
      ghost: false,
      essential: note.inclusion === "essential",
      degree: degree.get(note.id) ?? 0,
    })),
    ...[...ghosts.values()].map((ghost) => ({ ...ghost, degree: degree.get(ghost.id) ?? 0 })),
  ];
  return { nodes, edges, outgoing, backlinks };
}

/** The notes within `depth` links of `id`, in either direction, for the local graph. */
export function neighbourhood(
  graph: Pick<VaultGraph, "edges">,
  id: string,
  depth = 1,
): Set<string> {
  const adjacent = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    (adjacent.get(source) ?? adjacent.set(source, []).get(source)!).push(target);
    (adjacent.get(target) ?? adjacent.set(target, []).get(target)!).push(source);
  }
  const seen = new Set([id]);
  let frontier = [id];
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const node of frontier)
      for (const other of adjacent.get(node) ?? [])
        if (!seen.has(other)) {
          seen.add(other);
          next.push(other);
        }
    frontier = next;
  }
  return seen;
}

export function subgraph(graph: Pick<VaultGraph, "nodes" | "edges">, keep: ReadonlySet<string>) {
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
  };
}

export type VaultFolder = {
  name: string;
  path: string;
  folders: VaultFolder[];
  notes: VaultNote[];
};

/**
 * Where a note sits in the tree. Task notes live under tasks/<conversation id>/, which means
 * nothing to a person, so they show under "conversationsLabel / <conversation title>".
 */
export function vaultDisplayPath(
  note: Pick<VaultNote, "path" | "taskThreadId" | "taskThreadTitle">,
  conversationsLabel: string,
  untitled: string,
): string {
  if (!note.taskThreadId) return note.path;
  const prefix = `tasks/${note.taskThreadId}/`;
  const rest = note.path.startsWith(prefix) ? note.path.slice(prefix.length) : noteTitle(note.path);
  const title = (note.taskThreadTitle?.trim() || untitled).replace(/\//g, "∕");
  return `${conversationsLabel}/${title}/${rest}`;
}

/** Notes of one group as nested folders, folders first, both in name order. */
export function folderTree(notes: readonly VaultNote[]): VaultFolder {
  const root: VaultFolder = { name: "", path: "", folders: [], notes: [] };
  for (const note of notes) {
    let folder = root;
    for (const part of noteFolder(note.path).split("/").filter(Boolean)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let child = folder.folders.find((entry) => entry.name === part);
      if (!child) {
        child = { name: part, path, folders: [], notes: [] };
        folder.folders.push(child);
      }
      folder = child;
    }
    folder.notes.push(note);
  }
  const sort = (folder: VaultFolder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.notes.sort((a, b) => noteTitle(a.path).localeCompare(noteTitle(b.path)));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** Case-, accent- and extension-insensitive match on title, path and text. */
export function matchesVaultQuery(
  note: Pick<VaultNote, "path" | "content">,
  query: string,
): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return fold(note.path).includes(needle) || fold(note.content).includes(needle);
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("und");
}

export const MEMORY_NOTE_MENTION = "memory-note:";
export const MEMORY_NEW_NOTE_MENTION = "memory-new:";

/**
 * Rewrites resolved and unresolved `[[links]]` as the markdown renderer's mention links, so
 * the page can render them as buttons. Code keeps its literal text.
 */
export function wikiLinksAsMentions(note: VaultNote, resolve: LinkResolver): string {
  const links = resolveNoteLinks(note, resolve);
  if (!links.length) return note.content;
  let output = "";
  let cursor = 0;
  for (const link of links) {
    output += note.content.slice(cursor, link.start);
    const label = (
      link.alias ??
      (link.heading ? `${noteTitle(link.target)} › ${link.heading}` : noteTitle(link.target))
    ).replace(/[\\[\]*_`<>]/g, "\\$&");
    const id = link.noteId
      ? `${MEMORY_NOTE_MENTION}${link.noteId}`
      : `${MEMORY_NEW_NOTE_MENTION}${link.target}`;
    output += `[${label}](${markdownMentionHref(id)})`;
    cursor = link.end;
  }
  return output + note.content.slice(cursor);
}
