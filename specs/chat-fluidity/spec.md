# Conversation responsiveness

Keep the existing conversation layout, selected model and provider, approval rules,
queue/steering semantics and authoritative event reducer.

- A submitted message appears immediately as a local pending row, including its
  attachment names. It is not a committed message or a model reply. Scope it to
  the current account, Space and thread; reconcile using the exact client nonce
  from a durable event or the acknowledged message sequence, never matching text.
- Failed sends remove the local row and retain existing draft/attachment recovery.
  An SSE delivery before the HTTP response must not produce a duplicate bubble.
- Reduce every event in order and advance the authoritative reference immediately.
  Paint the first progress event immediately and coalesce subsequent progress to
  animation frames. Structural events, completion, errors, navigation and explicit
  preference changes flush immediately. Cancel pending frames on unmount.
- Motion acknowledges pending send, first live reply and control changes. Do not
  replay a streamed reply on completion or animate history loads and token updates.
  Preserve scroll ownership, reduced motion, keyboard and assistive feedback.
- Measure real components in a deterministic browser fixture at desktop and mobile
  widths, including slow acknowledgements, SSE-first delivery, rejection, navigation,
  long transcripts and progress bursts. This is UI evidence, not a live model's
  first-token latency or installed Desktop qualification.

Use existing components and CSS; add no animation dependency or artificial
typewriter delay. Publish exact integrated API/worker/web artifacts with rollback
and public health checks, preserving active configuration and immutable assets.
