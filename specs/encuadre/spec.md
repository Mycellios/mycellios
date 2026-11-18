# Encuadre v1 — product demo app as a hosted bundle

## Scope

Encuadre is a published Hifa Store app, not host code. Its source of truth is
the separate local repository `Encuadre` (bundle, tests, admitted JSON); on the
platform it lives only in the existing hosted-web storage (`hosted_webs.draftBundle` and frozen
`hosted_web_revisions.bundle`), uploaded and published through the owner-scoped
publication API. No Encuadre source, assets or tests are committed to the repo.

Users import a local recording, place it on a framed canvas, add timed zooms
toward chosen points, preview and download the result. All media stays in the
visitor's browser: no upload, model, paid call or server storage.

## Provenance

Clean-room implementation. OpenVid (PolyForm Noncommercial 1.0.0) is a product
reference only: copy no source, assets, presets, names or screenshots. The only
third-party code is a pinned Mediabunny ESM build (MPL-2.0), shipped unmodified
with its license text and version/hash in a `NOTICE.txt` inside the bundle.

## Host change: `downloads` capability (implemented)

Hosted documents are served with `sandbox allow-scripts`, which blocks downloads.
A bundle may carry `capabilities: ["downloads"]`, set by the owner in the editor,
frozen into the published revision digest, and applied as `allow-downloads` only
to that revision's responses and its Hifa Store/preview iframe. No migration: the
grant lives in the existing bundle JSON. See `specs/hosted-webs/spec.md`.

Screen recording is out of scope. Verified in Chrome: with display-capture
delegated, `getDisplayMedia` still fails with `SecurityError: Invalid security
origin` because the sandbox origin is opaque. Making it work would require
`allow-same-origin` on the main domain (rejected) or a separate host capture
bridge/origin (future spec). Users record with their OS tool and import the file.

## App behavior (inside the bundle)

- Input: file picker (browser-decodable MP4/WebM/MOV). Five minutes and 250 MiB
  maximum; actionable errors for unsupported media.
- Canvas: 16:9, 9:16, 1:1, 4:3; flat background color, padding, corner radius,
  optional flat window frame. No gradients or shadows.
- Zooms: non-overlapping ranges with normalized focus point, scale 1–3× and
  easing duration; created by clicking the preview, editable numerically.
  Overlaps are rejected. Preview and export share one deterministic frame
  function. Optional start/end trim. No text, shapes, 3D or GIF in v1.
- Export with Mediabunny/WebCodecs on the main thread (CSP forbids workers):
  MP4/H.264/AAC, or WebM/VP9/Opus explicitly when MP4 is unavailable; 720p/1080p.
  Progress, cancel, in-app playback of the real output, then download.
- Project settings (format, background, zooms, trim) autosave per user through
  the Hifa Store `storage` bridge, keyed by a fingerprint of the source video
  (name, size, duration). Re-importing the same video restores them; "Empezar de
  cero" deletes them. The video itself is never stored. Without the grant the app
  says autosave is unavailable.
- Bundle fits existing limits (≤100 files, 1 MiB/file, 4 MiB total).

## Qualification

Host (done): capability admission/rejection, digest stability, per-revision CSP,
unchanged headers without grants, iframe attributes, editor preservation, and a
real-Chrome check of download allowed/blocked. App: real-browser check of a
labelled synthetic clip through import → zoom → export → download → re-import
(duration, size, codec) in a private preview. Publishing to an account is an
explicit owner action, never part of CI.
