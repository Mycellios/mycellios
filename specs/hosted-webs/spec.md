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
