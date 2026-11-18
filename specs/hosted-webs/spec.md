# Hosted webs v1

## Scope

A single Apps library for static websites/public-data utilities and fixed native
Mycellios app launchers. Their hosting/execution boundaries remain distinct. Account/Space owners upload HTML/CSS/JS/assets,
edit a private draft, preview it, and explicitly publish a frozen revision under
the deployment's Mycellios domain. No backend, model invocation, credentials or
Mico tool permissions are granted to a published website.

## Boundaries

- Every document response enforces a CSP `sandbox allow-scripts` without
  `allow-same-origin`, independently of an embedding iframe. Public content never
  receives a Desktop bridge, host storage, forms, popups or top-navigation rights.
- Use bounded, allowlisted static files and canonical relative paths. Reject
  hidden/config/server files, duplicate paths and traversal; no server execution.
  Public network access is browser-mediated HTTPS; the server never proxies an
  author-supplied URL. CSP cannot prove a third-party domain resolves publicly.
- Drafts, pins and all mutations require current account/Space membership and
  ownership, with RLS as a second fence. Publication is an explicit CAS operation
  on the reviewed draft version. Draft source uses existing Space encryption.
- Only frozen published files and public metadata are readable without login.
  Stable document URLs redirect to a revision path so relative assets cannot mix
  releases during publication. Withdrawal revokes every retained version URL.
  Public DTOs omit account IDs, Space IDs, author identity and draft content.
- Count successful public document GETs, deduplicated per site/day and a rotating
  HMAC of trusted client address/browser. No raw addresses, cookies or visitor IDs
  are stored. Trends use those actual visits, never seeded popularity.
- Clones copy a published revision into an independent owned draft. Editing or
  unpublishing a clone cannot mutate the source. Owners can unpublish their site.
- An owner may grant one optional capability, `downloads`, stored in the bundle
  JSON and frozen into the published revision digest. Only that revision's
  responses and the Hifa Store/preview iframe add `allow-downloads`; the stable
  redirect grants nothing, clones start without it and Mico edits preserve it.
  Unknown names are rejected. Screen capture is not offered: Chromium rejects
  `getDisplayMedia` from the required opaque origin, and `allow-same-origin` is
  never granted to hosted content.
- `storage` changes no header. It enables the host bridge: the Hifa Store page
  answers `{type:"mycellios.storage", id, op, key, value, prefix}` messages only
  from the exact iframe it rendered, scoped by the host to (app, user, Space,
  preview). Rows live in `hosted_web_data` (Space-encrypted, forced RLS, deleted
  with the app), limited to 1 MiB per value, 1,000 keys and 5 MiB per user/app.
  The grant is read from the exact published revision (visitors) or saved draft
  (owner preview, separate namespace). Replies use target `*` because the frame
  origin is opaque; an app that navigates its own frame only exposes its own
  data. Verify with `scripts/verify-hosted-webs-db.ts` and the bridge tests.
- Every saved draft version (owner save, Mico `app_write`, restore) is recorded
  in `hosted_web_snapshots`: Space-encrypted, immutable, owner-only (forced
  RLS), skipped when unchanged, pruned to the newest 50 within 64 MiB per app and
  deleted with the app. Restore is a CAS-guarded new draft version; it never
  publishes and the UI refuses it over unsaved local edits.
- `files` (large per-user files) is **unavailable by default**. It requires
  `MYCELLIOS_HOSTED_WEB_FILES_ENABLED=true` and the object artifact store; it never
  writes to the server's local disk. While unavailable, new grants and uploads are
  refused (existing files stay readable/deletable). Limits: 25 MiB per file
  (also capped by the deployment upload limit), 250 MiB and 200 files per user
  per app; `MYCELLIOS_HOSTED_WEB_FILE_MAX_MB`/`MYCELLIOS_HOSTED_WEB_FILES_QUOTA_MB`
  can only lower them. Metadata lives in `hosted_web_files` (forced RLS); bytes
  are sealed per Space. Every deleted row (replace, delete, app/user/Space
  cascade) leaves a tombstone whose object is removed by the sweep (on file
  writes, account/Space deletion and every 30 minutes).
- The base CSP allows `media-src 'self' blob: data:` so apps can play their own
  bundled or in-memory media; remote media sources stay blocked.
- Limits: 20 sites/account/Space, 100 retained revisions/site, 100 files/bundle,
  1 MiB/file and 4 MiB decoded total. No ZIP extraction or arbitrary backends in v1.

## Conversational editor

- One Apps entry replaces the previous Webs and Apps de Mycellios entries. Legacy
  Webs links open Apps; browser users retain static authoring without Desktop.
- Assign an owned, current Space Mico to an app. A dedicated `mico-task` thread
  reuses standard send, SSE recovery, Markdown, approvals and stop controls.
- `app_read` / `app_write` resolve the draft from the actual run and persisted
  bot/thread binding, never an arbitrary app ID. Recheck ownership, membership,
  archived state and active run. Serialize edits with reassignment and enforce
  optimistic versions against manual edits. No implicit OS workspace or publish.
- Preview follows saved draft versions; do not overwrite dirty manual source.
  An owner reviews and explicitly publishes the new frozen revision.

## First site

Antseed Radar uses only `https://network.antseed.com/stats`, documented at
`https://antseed.com/docs/api/routing/`. Search advertised services, compare token
prices, estimate token costs and distinguish per-unit billing. Label indexer
snapshots, update time, stale/error state and community/nonofficial status. No
personal identity, account access, paid calls or invented metrics.

## Qualification

Focused admission, CSP/HTTP, ownership/CAS/clone/publication/view tests; actual
PostgreSQL migration and RLS denial checks; affected contract/API/web typing and
real browser inspection. Publishing infrastructure/build/health is a separate
gate; a local preview is not production publication.


## Creator-owned catalog covers

Store cards are read-only; edit the cover inside the owner's app editor. Built-in
apps have no user-owned author identity and expose no cover editing. Existing
personal artifact histories remain private and are not promoted into public cover
endpoints. Legacy cover writes require the current app creator and Space again,
including before idempotent replay and inside the write transaction.

Community covers use exactly one reserved raster asset, mycellios-cover.png,
mycellios-cover.jpg or mycellios-cover.webp, in the normal encrypted static draft.
Upload and Mico generation remain explicit; applying a candidate changes only the
local draft. Existing save CAS, ownership, membership, total/per-file size and
publication checks remain authoritative. Only explicit publication exposes the
cover, and catalog DTOs contain only its fixed path and immutable revision ID,
never the draft, owner identity or arbitrary private artifact metadata. Public
images use the existing sandboxed, nosniff static-file route. Withdrawal and
account deletion preserve the existing publication revocation behavior.
