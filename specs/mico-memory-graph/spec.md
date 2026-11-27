# Mico memory graph

Status: draft (opened 2026-11-27). Sections 4 and 5 are implemented in a local
change, not merged: the Memory rail page (vault tree, note view/editor with
`[[link]]` completion, backlinks, local and full graph) and "Memory in context"
recall receipts. Sections 1, 2, 3 (server links), 6 and 7 are not implemented
and change nothing that a Mico receives.

Implementation notes for the delivered part:

- Links, backlinks and the graph are derived in the browser from the notes the
  person already reads (`apps/web/src/lib/memory-vault.ts`); there is no
  `memory_links` table and recall does not follow links.
- `memory.create` creates a note only when its path is free (revision 0) and
  marks it user-controlled; `memoryNotePath` rejects traversal and `tasks/`.
- Receipts live in `run_memory_recalls` (run id, owner, note ids; owner RLS,
  cascades with the run, no retention job). The executor records them without
  awaiting; a failure or a missing table never affects the run.
  `memory.recall({ messageId })` reads them for the owner's own Mico messages.
- Task notes are not shown on the page (they stay in their conversation).

## Goal

People notice that their Micos remember them better, can see why a Mico knows
something, and can browse and edit their memory as a linked graph of notes in
its own workspace page, the way a personal notes vault works. All of it without
new running cost for the operator.

## Principles

- **No new paid calls.** No hosted embeddings, no reranker, no second model call
  per turn or per review. Everything new is deterministic server logic, browser
  rendering or extra fields in the existing `memory.review` call, inside its
  current 0.002 Credit per review / 0.01 per Space-day reservation.
- **Smaller prompts.** Recall injects relevant sections instead of whole
  documents, so better memory also makes each turn cheaper and faster for the
  payer.
- **Markdown stays the source.** `MemoryDocument` and `MemoryRevision` remain
  canonical. Links, sections and graph positions are derived and rebuildable.
- **Same boundaries.** Space content encryption, owner RLS, isolated scope, the
  rule that a Mico never reads another Mico's notes, no memory for messaging
  channels, groups, Space-member turns or restricted runs.
- **The person decides.** Automatic changes never override user-controlled
  notes; suggested merges and contradictions need an explicit choice.

## Non-goals

- Semantic/vector search for local memory. It may come later only as an
  optional route on the person's own nodes (`mycellios-qwen3-embedding-0.6b`,
  owner-scoped), never on operator-paid infrastructure.
- A product-specific integration with any external notes app. Compatibility is
  plain Markdown with `[[wikilinks]]` and front matter.
- Changing personal MCP memory (`specs/mcp-memory/spec.md`) or the legacy Space
  providers.

## Current state

- `MarkdownMemoryStore` (`src/agent/packages/memory/src/index.ts`) reads, ranks
  (`rankLocalMemories`, lexical, whole documents), commits with revision guards
  and exports/imports flat Markdown files.
- `loadAgentMemoryContext` injects all `essential` documents (8 KiB per scope)
  plus the top 5 `searchable` documents, up to 32 KiB, as `<durable_memory>`.
- `memory.review` (`adapters/src/local-memory-review.ts`) extracts up to 8 facts
  with `sourceMessageId` and writes `reviews/<key>.md`. It does not compare them
  with existing notes, so paraphrased duplicates accumulate.
- No link, obsolescence, reinforcement or recall receipt exists. The only UI is
  Settings → Memory and the per-Mico `KnowledgeSection`.
- The workspace rail (`apps/web/src/pages/shell/workspace-rail.tsx`) lists pages
  from `RAIL_PAGES` (`lib/workspace-rail-pins.ts`); saved pins are per
  account/Space in local storage.
- Content columns are encrypted in the application, so PostgreSQL cannot index
  note text. All text processing happens after decryption in the API/worker.

## Design

### 1. Sections and better lexical recall (phase 1)

- Split each decrypted document into sections by `#`/`##`/`###` headings
  (2,000 characters max, front matter excluded). Sections are computed
  in-process and never stored; the per-person corpus is small.
- Rank sections with a tolerant three-pass match (all terms, then any two, then
  any one for short queries), weighted fields (title > heading/tags > body),
  exact-title boost, ES/EN stop words already in `memory-ranking.ts`, and one
  section per document in the result.
- Follow resolved links one hop from the top results (section 3), with a lower
  score, so linked context arrives together.
- `<durable_memory>` keeps essential documents whole and injects the selected
  searchable sections. Lower the searchable part of the budget from whole
  documents to sections; never exceed today's 32 KiB.
- `search_local_memory` returns sections with path, heading and snippet;
  `read_local_memory` is unchanged.

### 2. Consolidation and obsolescence (phase 1)

- `MemoryDocument` gains `status` (`active` | `superseded`), `supersededById`,
  `reinforcedAt`, `reinforcementCount` (additive migration; defaults keep every
  existing note active).
- Before applying review facts, compute a fingerprint (scope + key + normalized
  text) and compare with existing notes in the same visible scope:
  - same fingerprint or normalized text already contained → reinforce the
    existing note (counter + timestamp + revision source), write nothing new;
  - otherwise create, as today.
- The existing review prompt may also return, per fact, `supersedes: <key or
  path>` and `links: [<key or path>]`, choosing only from note keys included in
  its snapshot. The server validates that each target exists in the same visible
  scope, is not user-controlled for supersession, and has not changed since the
  snapshot. A valid supersession sets the old note `superseded` with
  `supersededById`; it never deletes text.
- Superseded notes leave automatic recall and `search_local_memory` (shown only
  on explicit request) and appear dimmed in the UI with "Replaced by …" and a
  restore action.

### 3. Links (phase 2)

- Links are `[[path]]`, `[[path#heading]]`, `[[path|label]]` or `[[title]]`
  inside note content, parsed on the server after decryption.
- Resolution order: exact path, path without `.md`, then a unique case-folded
  title. Ambiguous or missing targets stay unresolved (shown as ghost nodes in
  the browser only).
- `memory_links` stores only resolved pairs: `sourceId`, `targetId`, `kind`
  (`wikilink` | `review`), `spaceId`, `userId`. No link text, so no plaintext
  outside the encrypted columns. It is rebuilt for a document on every commit in
  the same transaction and cascades on delete. RLS as `memory_documents`.
- Visibility rules for links:
  - a Mico follows a link only if the target is in its own visible set (its
    notes, its task notes, and general notes unless isolated);
  - a link to another Mico's note is kept for the person's own view but never
    followed for, or revealed to, a different Mico;
  - task notes link only within their task or to general/Mico notes.
- Backlinks are a query on `targetId`.

### 4. Recall receipts: "Used N memories" (phase 2)

- Each run that places local memory in its prompt records a receipt with the
  note ids, in prompt order. Ids only, no content, owner RLS; it cascades with
  the run. Search tool results are not recorded yet.
- A Mico message's More menu offers "Memory in context". It lists the notes the
  reply had available (not a claim that it relied on them) and opens each on the
  memory page. A count on the message itself and "Learned in …" from
  `MemoryRevision.sourceThreadId` are not implemented.
- Not shown for groups, channels or member turns, which receive no memory.

### 5. Memory page in the workspace rail (phase 3)

- New rail page `memory` (Brain icon) between Library and Board, pinned by
  default. Existing saved pins do not include it: add a one-time versioned
  migration that appends `memory` once per scope and is never repeated, so a
  later unpin is respected. Mobile menu gets the same entry.
- Route `?view=memory` in the Shell, mounted like Library, with these panes:
  - **Left:** a vault tree grouped as General, each Mico, and tasks under their
    Mico; search across titles and sections; filters (scope, Mico,
    essential/searchable, show superseded).
  - **Centre:** the selected note in Markdown. Edit mode with `[[` autocomplete
    from visible note titles; save uses the existing revision guard and marks
    the note user-controlled. Rendered `[[links]]` are clickable. A footer shows
    backlinks, "Learned in …" and revision history.
  - **Right:** a local graph of the note and its neighbours (depth 1, toggle 2).
  - **Graph mode:** a full-page toggle for the whole graph.
- The graph:
  - nodes are notes; edges are resolved links;
  - colour is by scope (general, each Mico's palette accent, task) using flat
    Agent tokens, never gradients;
  - size is by link degree plus reinforcement; superseded notes are dimmed;
    unresolved links are hollow ghost nodes;
  - layout is a bounded force simulation in a Web Worker with a fixed seed. It
    stops after it settles and pauses when hidden or offscreen. Reduced motion
    gets the settled layout without animation;
  - hover highlights neighbours; click opens the note; wheel/pinch zooms; drag
    pans. Keyboard users get the same graph as a focusable, ordered list of
    nodes and neighbours;
  - bounded at 2,000 nodes; beyond that it starts on the local graph and asks
    the person to filter.
- Data: one owner/Space-scoped `memory.graph` RPC returns nodes (id, path,
  title, scope, botId, status, inclusion, degree, updatedAt) and edges. Titles
  are decrypted server-side for the owner only. No content until a note is
  opened.
- Settings → Memory stays for configuration (providers, personal memory
  connections, review frequency) and links to the page.

### 6. Vault export and import (phase 4)

- Export as a ZIP: `General/`, `Micos/<name>/`, `Micos/<name>/tasks/<title>/`,
  with front matter (`inclusion`, `status`, `updated`, `source`) and links
  rewritten to vault-relative `[[...]]`. Superseded notes go under `_replaced/`.
- Import a vault ZIP into General or a chosen Mico. Bounded at 2,000 files and
  10 MiB total, Markdown only. Binary attachments, scripts and anything outside
  the root are skipped. Imported notes are user-controlled and searchable.
  Paths are normalized and collisions get a suffix. Nothing is executed or
  fetched.

### 7. Suggestions (phase 4)

- Deterministic detectors run after a review or an import:
  - same normalized title with different content (possible contradiction);
  - near-identical normalized text (possible duplicate);
  - `essential` notes not recalled in 60 days.
- Results appear as dismissible cards on the memory page: merge, keep both,
  mark one replaced, or dismiss. Nothing changes without the person's choice.

### 8. Quality measurement

- A synthetic golden set in tests: fixture notes plus queries with expected
  documents. CI reports hit@1, hit@5 and the empty-result rate for the ranker
  before and after each change. No real user data.

## Phases

| Phase | Scope | Visible result |
|---|---|---|
| 1 | Sections, three-pass ranking, consolidation, obsolescence, golden set | Better recall, no duplicates, no outdated facts |
| 2 | Links table, backlinks, link-following recall, recall receipts in chat | "Used N memories", connected notes |
| 3 | Rail page, vault tree, editor, local and full graph | Notes graph view of the memory |
| 4 | Vault export/import, suggestions | Portability and cleanup |

Each phase ships separately with its own migration. Each migration is additive
and has a rollback that ignores the new columns.

## Verification

- Unit: ranking/sections/golden set, link parser and resolver, consolidation and
  supersession rules (including user-controlled and changed-snapshot refusals),
  link visibility across Micos and isolated scope, rail pin migration.
- `scripts/verify-local-memory-db.mjs` extended for the new columns, links
  cascade, RLS and encryption round trip on isolated PostgreSQL.
- Web: memory page and graph component tests, i18n catalog
  (`messages.po`), reduced motion, keyboard list, 2,000-node bound, mobile
  layout. Browser check of the real page with synthetic RPCs.
- Review cost: assert the reservation and per-review cap are unchanged.

## Open questions

- Whether general notes created by the person are visible in the graph of
  every Mico or only in the General view (proposal: visible to non-isolated
  Micos, as in recall).
- Whether recall receipts should be visible to Space admins (proposal: no,
  owner only).
- Whether the full graph should start with General plus the open Mico, or with
  everything (proposal: the open Mico, with a toggle).
