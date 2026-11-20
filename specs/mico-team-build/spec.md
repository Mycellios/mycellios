# Mico team builds a hosted web

## Outcome

From an app's editor, the owner asks a lead Mico to build the site with a team.
The lead splits the work into delegated tasks, one per Mico. While they work, the
owner sees, at the same time and from real actions only:

- the team roster with each Mico's actual Working/Queued/Idle state;
- the lead's split as a task list with per-task status and the existing controls;
- the live preview of the shared draft, reloading on each saved version;
- one named cursor per Mico, in that Mico's color, placed over the element or file
  it is actually reading or writing;
- a "Building · N Micos" indicator counting runs that are actually executing.

Publishing stays the owner's explicit button on the reviewed draft version.

## Not in scope

- No fabricated, scripted or replayed activity in the product. A marketing scene
  of this flow is separate conceptual artwork and must be labelled as such.
- No new hosting, domain, quota or publication path: reuse hosted webs v1
  (`specs/hosted-webs/spec.md`) unchanged, including its limits and CSP.
- No new concurrency allowance. The number of Micos working at once is bounded by
  worker concurrency, `Bot.taskConcurrency` and delegation resource conflicts; the
  UI shows queued tasks as queued rather than implying parallel work.
- No browser/computer control of the preview. Micos edit through `app_read` and
  `app_write`; cursors visualise those calls, not pointer automation.

## 1. Shared draft access for delegated work

Today one `HostedWebAgent` binds one site to one thread, and delegated children
get new threads, so their `app_write` fails.

- An app run resolves its site from its own thread binding, or else from the
  binding of its task's `delegationRootId` thread. No other lookup and no
  client-supplied site id.
- The delegated task must be live (not paused, cancelled or settled), in the same
  user and Space, its Mico current and unarchived and, for a group thread, a group
  member. Recheck these and the binding inside the write transaction.
- Reassigning or removing the site's agent revokes access for the whole
  delegation tree immediately, including runs already in progress.
- No schema change is needed for this resolution. If one becomes necessary it
  must be additive.

## 2. Concurrent edits

Several Micos writing one draft must not silently overwrite each other.

- `app_write` gains an optional `expectedFileSha256` for the target path. When it
  is given, the write is accepted if that file's current content still matches,
  even if other files moved the site version on. The draft version increments
  once per accepted write, under a row lock.
- Without it, the existing whole-draft `expectedVersion` check applies unchanged.
- A mismatch returns the current file hash and version, so the Mico reads again.
  Never merge text automatically.
- Snapshots record every accepted version as today. The 50-snapshot/64 MiB
  retention may drop intermediate team versions; that is acceptable and stated.
- The lead should assign file ownership through delegation resources, e.g.
  `site:<path>`, so the existing conflict check serialises tasks that write the
  same file. The resource set is normalised and bounded like existing resources.

## 3. Team flow in the editor

- The editor offers "Build with team": choose an existing group of Micos, or
  create one from current Space Micos, and a lead. The app's agent thread becomes
  that group thread, so delegated children share it (`work-delegation.ts`).
- The lead receives a bounded system instruction for team builds: plan files,
  delegate one coherent part per Mico with `site:<path>` resources, review the
  results and report. It must never claim the site is live: publication is
  outside its tools.
- The task list reuses the delegation data (`rpc.tasks.overview`, subagent
  blocks) with the existing Stop/Continue/Reassign controls; no parallel model.
- Each run uses normal credit admission and holds. Show the per-run usage that
  already exists; do not estimate team cost from unmeasured data.

## 4. Live presence (cursors)

- New transient event `web.presence`: `{siteId, botId, runId, path, phase:
  "reading" | "writing", target?: {kind: "selector" | "file", value}, at}`.
  It is published only by the server while executing `app_read`/`app_write`,
  never accepted from clients or models, and never stored durably.
- Target derivation is deterministic, on the server:
  - HTML write: a CSS path to the first element whose subtree changed;
  - CSS write: the first changed rule's selector, if it exists in the page;
  - read, or other files: `{kind: "file"}`.
- Fan-out reuses the realtime NOTIFY path, scoped to the site's owner, user and
  Space, with the same re-authorisation as `threads.subscribe`. Bounded rate per
  run; payloads hold no file content.
- Preview-only documents (never published revisions) include a tiny locator that
  answers `{type:"mycellios.locate", id, selector}` with a rect, only to its
  parent. The host accepts replies only from the exact iframe it rendered. The
  iframe keeps `sandbox allow-scripts` without `allow-same-origin`.
- The host overlay draws one cursor per Mico, with name, avatar and `Bot.color`.
  It animates towards the rect, or parks by a file chip when there is no rect.
  It fades out 8 s after that run's last event and immediately when the run ends.
  Reduced motion jumps without animation. Cursors never take pointer events.
- "Building · N Micos" counts runs of the delegation tree in `running` state, from
  the same data as the roster, not from presence events.

## 5. Delivery

Small PRs, each independently safe:

1. Shared draft access plus `expectedFileSha256`, with API and adapter tests.
2. `web.presence` contract, server emission and authorised subscription.
3. Preview locator, overlay and indicator in `HostedWebEditor`, with Storybook
   stories that feed recorded presence events (clearly fixture data).
4. "Build with team" flow, lead instruction and task list.

## Qualification

- Isolation: a child of another tree, another Space, a paused or settled task, or
  a revoked binding cannot read or write. Test on isolated PostgreSQL with RLS.
- Concurrency: two Micos writing different files both succeed; same file with a
  stale hash is rejected; versions stay monotonic.
- Presence: events only from real tool execution; unauthorised subscribers receive
  nothing; published revisions contain no locator; locator replies from other
  frames are ignored.
- UI: a browser fixture with intercepted RPCs renders the editor with several
  cursors, reduced motion and mobile width, and produces screenshots for review.
  Fixture results do not qualify live models or paid inference.
- A real run with at least three Micos on a test account is a separate,
  explicitly reported gate. No production deployment is part of this change.

## Status

- Shared draft access and `expectedFileSha256`: delivered (#365).
- Presence: delivered. The worker publishes `HostedWebPresence` on the existing
  realtime fanout (`web-presence:<siteId>`, `packages/db/src/web-presence.ts`) only
  after an authorized `app_read`/`app_write` commits, at most one signal per run
  every 250 ms. `webs.presence` streams it to the app's owner with heartbeats and
  the usual session/ownership recheck. HTML targets use the innermost element at or
  before the first changed character (`hosted-app-presence.ts`), anchored at the
  nearest id; CSS targets use the first changed rule's selector.
- Locator, overlay and indicator: delivered in `TeamPresence.tsx`. The locator is
  injected only into preview HTML (`preview-locator.ts`); published revisions are
  checked not to contain it. `webs.team` reads running/queued runs of the bound
  thread and its delegated children. Cursors drop when their Mico stops running
  (team refresh every 3 s) or 8 s after their last signal. There is no Storybook
  in this workspace, so no stories were added.
- Team flow: delivered in a reduced form. "Construir con equipo" lets the owner
  pick teammates and writes an editable request into the app chat; nothing is sent
  until Send. The app instructions tell the lead to delegate with `delegate_task`
  and `site:<file>` resources and review the results. The agent thread is not
  converted into a group thread; the existing delegation tree already shares the
  draft.
- Qualification: unit tests and `scripts/verify-hosted-webs-db.ts` on embedded
  PostgreSQL pass. NOT RUN: the browser fixture with intercepted RPCs and the real
  run with three Micos on a test account.
