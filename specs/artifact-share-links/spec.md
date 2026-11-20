# Share an artifact by link

## Goal

Micos produce reports, pages, images and documents as artifacts. Today the
owner can only view or download them inside their account. Let the owner send
one to someone else with a link, and stop sharing it at any time.

Reference: Rerun publishes coworker files as links with access modes (AGPL-3.0,
behavior reference only; no code is copied). This is deliberately smaller.

## Scope

- One link per artifact family, created and revoked only by the owner from the
  Library preview. Micos get no tool to share or publish.
- The link shows one exact version, the one the owner shared. A newer version
  made by a Mico changes nothing until the owner shares it again ("Update link"),
  which keeps the same address.
- Anyone with the link can open it. The token is 32 random bytes (base64url);
  it is the only secret. Revoking deletes the row and the address stops working
  for everyone. Deleting the artifact deletes its link.
- Not in this version: members-only links, passwords, email invitations,
  viewers for slides or spreadsheets, view counts, link expiry.

## Serving

`GET|HEAD /api/shared/<token>` on the API host, mounted before CORS and auth
like published webs. It looks the token up in system context and reads the
pinned version from the artifact store with the owner's Space context.

Every response, including errors:

- `Content-Security-Policy: sandbox allow-scripts; default-src 'none';
  script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;
  font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none';
  base-uri 'none'; frame-ancestors 'none'`. The document gets an opaque origin,
  so it cannot read the app's session, and it has no network access, so a page
  cannot send what a visitor types anywhere. Images in shared HTML must be
  embedded, as for HTML previews today.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Robots-Tag: noindex, nofollow`, `Cache-Control: private, no-store`, the
  published-web `Permissions-Policy`.
- Inline display only for HTML, PDF, images, audio, video and plain text
  (Markdown and CSV are shown as UTF-8 text). Everything else is a download.
- Unknown, malformed or revoked tokens answer the same 404.

## Data

Additive table `artifact_shares`: `id`, unique `token`, unique `rootArtifactId`
(family), pinned `artifactId`, `spaceId`, `userId`, timestamps. Cascades from
artifacts, Spaces and users. Row-level security: owner (Space + user + member)
and system context only.

## Verification

API unit tests for share/update/revoke ownership, token lookup, headers per
type and the 404 for revoked links; the Library share control in a component
test; isolated PostgreSQL for the migration and RLS. A real link opened from
another browser without a session is the acceptance check.
