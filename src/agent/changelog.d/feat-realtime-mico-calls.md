### Added

- Realtime calls: when the server offers them, turn on Settings → Voice → Realtime calls to
  talk with a Mico that answers as you speak and that you can interrupt. They use your own
  OpenAI voice key, which OpenAI charges. The Mico still does the work with its own tools and
  approvals. If the realtime voice cannot start, the call continues with the standard voice.
- During a call, the Mico tells you when work in another conversation finishes, fails or
  needs your answer.

### Fixed

- Approving a request by voice during a call works again, in Spanish and English: a clear
  yes allows it once and a clear no denies it. Anything else is not taken as an answer, and
  "always allow" stays on screen.
- Calls no longer send room noise to transcription or freeze after an empty transcript.
- Transcription with an OpenAI voice key spells your Micos' names correctly, and a
  transcript that only repeats those names is ignored.
