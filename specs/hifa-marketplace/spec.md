# Hifa marketplace v2 — user-built sandboxed apps

## Goal

Every account can create, edit (manually or with a Mico), remix and publish apps
in Hifa Store. App code and app data live only in platform storage (PostgreSQL
and the existing S3-compatible object store), never in this repository. Apps run
isolated: a bug or malicious app cannot read Mycellios cookies, sessions,
accounts, other apps' data or the host UI.

## Already delivered (hosted webs v1)

- Owner-scoped drafts in `hosted_webs.draftBundle` (Space-encrypted), immutable
  published revisions, clone/fork with `forkedFrom`, pins, trending, covers.
- Conversational editing through `app_read`/`app_write` with version CAS.
- Opaque `sandbox allow-scripts` CSP on the main domain; optional `downloads`.
- Limits: 20 apps per account/Space, 100 files, 1 MiB/file, 4 MiB per bundle.

## Gaps this spec closes

### 1. Isolated app origin

Today apps share the main domain, so they must stay opaque: no storage, workers,
screen capture or same-origin APIs. Serve published and preview documents from a
dedicated registrable domain (operator-configured, e.g. `*.<apps-domain>`), one
subdomain per app slug. Because that origin never receives Mycellios cookies,
`allow-same-origin` becomes safe there.

- `MYCELLIOS_APPS_ORIGIN` unset keeps v1 behavior (opaque, main domain). It must
  be a different registrable domain (eTLD+1) from the web/API; startup rejects
  same-site configuration.
- Per-app subdomains isolate apps from each other (storage, service workers).
  Preview uses a separate random subdomain per short-lived token.
- Owner-granted capabilities extend to `screen-capture` and `workers` only on
  the isolated origin. Still never: top navigation, popups to the main domain,
  forms posting to it, or any credentialed API access.
- No cookies are ever set on the apps domain; responses keep CSP and nosniff.

### 2. Persistent per-user app data

Users' projects inside an app (e.g. Encuadre zooms/settings) must survive reloads
and devices. Add a host-mediated storage bridge instead of giving apps API keys:

- The Hifa Store host page answers `postMessage` requests from the exact app
  iframe (`event.source` + origin check): `get`, `set`, `delete`, `list` on a
  per-(app, user, Space) namespace. The app never sees the session or user ID.
- Stored in a new `hosted_web_data` table (Space-encrypted JSON, RLS), keyed by
  site ID, so data survives new revisions. Quota: 5 MiB and 1,000 keys per
  user per app (configurable). Deleting an app deletes its data.
- Opt-in capability `storage`, visible on the store card. Anonymous visitors
  (direct link without login) get no bridge.

### 3. Large user files

Videos and other large inputs/outputs go to the existing sealed object store
(`ObjectArtifactStore`), not the bundle or JSON data:

- Capability `files`: upload/download through the same bridge, streamed, with a
  per-user quota (default 1 GiB total, 500 MiB per file), owner and Space scoped.
- Deployments without object storage report the capability unavailable.

### 4. Source history

Draft saves currently overwrite. Keep the last 50 draft snapshots per app
(content-addressed, encrypted), with restore. Mico edits create snapshots too.
Published revisions remain immutable and separate.

## Safety for a public marketplace

- Report app → owner-visible status; operator unpublish (existing revocation).
- Capabilities shown before opening an app and on its card; a new capability on
  a new revision requires the visitor to reopen with the updated list.
- Rate limits on bridge calls and object uploads; no server-side code
  execution, no outbound proxy, no paid model access from apps in v2.

## Delivery order

1. Storage bridge + `hosted_web_data` — **implemented** on the current opaque
   sandbox (no new domain needed). Migration
   `20261118170000_hosted_web_data` must be applied by the migration owner.
   Encuadre uses it for per-user project save/restore.
2. Draft history — **implemented**. Migration
   `20261118190000_hosted_web_snapshots`; the editor's "Historial de versiones"
   lists and restores snapshots.
3. Object-store files bridge — **implemented, unavailable by default** so users
   cannot fill the server with large videos. Enabling it needs
   `MYCELLIOS_HOSTED_WEB_FILES_ENABLED=true` plus configured object storage, and
   an explicit operator decision on quotas/cost. Migration
   `20261118210000_hosted_web_files`.
4. Isolated origin behind config (operator domain decision pending), then screen
   capture and workers for apps on it.

Each step ships with focused tests, isolated PostgreSQL migration/RLS checks
where applicable, and a real-browser check of the isolation boundary.

## Open operator decisions

- The apps domain name and its wildcard DNS/TLS.
- Default quotas (data, files) and whether files count against Credits.
