# Agent review workspace

Local implementation, not a production capability claim. Extend the existing Agent
shell with a resizable document/web review panel independent of computer providers.
Reuse file access authorization and existing PDF/HTML viewers. Comments become
editable composer drafts, never implicit model requests or executable instructions.

Keep tabs in memory within the current Space and clear them when switching chat.
Local uploads remain in this browser. Adding a comment puts the local file into
the existing attachment draft; only the user's normal Send submits it.
PDF.js renders pages without depending on a browser plugin. Region notes identify
the PDF page and visible viewport, not extracted page coordinates.
HTML artifacts keep their opaque-origin sandbox and network restrictions.
The web iframe fallback requires a cooperating page with the optional preview
bridge. Desktop now uses the isolated native inspector described in
[Project browser beside the chat](../project-browser/spec.md). Do not proxy
arbitrary URLs or disable frame/security headers. Validate source,
origin, session and bounded structured selection messages. Never include passwords,
input values or hidden page text in a selection.

Qualify parsing, draft scoping, bridge trust boundaries, loading/error/empty states,
tab switching/closing and keyboard controls locally; visually check desktop/mobile.
Local PDF.js validation uses the exact declared dependency in the isolated npm cache.
The wider canonical Agent npm-lock migration is still a release gate; this feature
does not authorize a deployment or assert that migration is complete.
