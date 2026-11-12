# Cadencia v1 — local browser speech editing

## Scope

First-party app in Hifa Store, on the existing signed-in local web surface.
Import a local video/audio file, propose silence and sustained voiced-sound cuts,
review each interval with before/after audio, adjust millisecond boundaries,
render and compare the actual edited video, and download it. No network media
upload, remote model, paid call or production deployment.

## Boundaries and behavior

- This is trusted first-party code, separate from published HTML sandboxes.
  Never give arbitrary hosted apps local-file, bridge or worker permissions.
- File selection is explicit. Limit imports to 250 MiB, five minutes, stereo,
  bounded output resolution and decoded sample counts. Reject unreadable/no-audio
  media and unsupported codecs with actionable errors.
- Decode incrementally using pinned Mediabunny/WebCodecs; keep only a 16 kHz mono
  analysis copy. Audio samples and video frames share the same source timeline.
- DSP runs in a cancellable worker. Silence uses conservative adaptive energy
  thresholds and boundary padding. Sustained voiced segments use periodicity,
  pitch and spectral stability; they are possible elongated vowels, not a
  linguistic diagnosis. They require individual opt-in and are never auto-applied.
- There is no transcription/forced word alignment in v1 and no promise of exact
  phoneme boundaries. Preserve short gaps and configurable edge margins.
- Cut proposals are non-destructive, individually selectable, adjustable and
  reversible. Merge overlaps before playback/export and reject invalid ranges.
- The loaded editor is one bounded workspace with a file toolbar, preview on the
  left and time saved, Create/Download and a compact cut list on the right.
  Stack the panels by available container width. Waveform and detection/codec
  details remain in closed disclosures beside the preview. Show per-cut playback
  only for the selected row and precise
  bounds in a nested disclosure. Inputs use seconds at 0.001-second precision;
  grouping/disclosure must never alter selected cuts or authorize vowel removal.
  Closing review stops its audition; the Original/Edited switch appears once an
  actual edited result exists. Preserve validation, cancellation and invalidation.
- Audition original/edited context with identical selected cuts. Export audio at
  its decoded native sample rate with short boundary fades, video on a bounded
  frame grid, sharing the compacted timeline. Never speed up speech.
  Hold the first/last picture for legitimate audio preroll/tails outside the
  video track; do not shift speech or hide missing interior frames.
- Use native codecs available in the browser; prefer MP4/H.264/AAC and explicitly
  use WebM/VP9/Opus when MP4 encoding is unavailable. No silent remote fallback.
- Keep current work in the existing account/Space memory cache across internal
  navigation. Clear on account change, revoke object URLs, stop audio, dispose
  codecs/workers on cancellation/unmount and release reload holds on removal.
- The built-in demonstration is explicitly synthetic and must exercise the same
  import/analyze/review/render pipeline as user files.

## Qualification

Focused signal/cut mapping tests, overlap/boundary/fade tests, actual browser
import/DSP/A-B/export/re-import inspection with a labelled synthetic fixture,
unsupported-media and cancellation behavior, account-cache continuity, responsive
UI and scoped typing/build. No real Manu recording or word-level model validation
is implied by synthetic qualification.
