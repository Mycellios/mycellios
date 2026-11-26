### Changed

- Fold the "Needs you" and "Projects" sidebar sections from their titles. Folded "Needs you"
  keeps a count of what waits, and each device remembers the choice.
- Simplify the conversations menu: one line per conversation, aligned status marks, and routine
  runs under their own "Routines" heading instead of a badge on each row.
- List free AntSeed models under their own "AntSeed · Free" heading in the model picker, and
  set the agent programs installed on this PC (Claude Code, Codex, OpenCode) apart from the API
  connections that share their logos.
- Show the Mycellios model list at once from the last catalog this device read, while the live
  one loads, and keep the catalog on the server for a minute so the picker opens quickly.
- Move "Open floating chat" to Chat tools. A narrow chat header now hides secondary actions
  instead of letting them overlap the conversation tabs.
- Show created, archived and deleted Mico notes as small status lines, like routine runs.
- Show only a quiet arrow for the steps of a turn that is still running.

### Fixed

- Stop dictation as soon as it starts when the microphone sends no sound or transcription is
  unavailable, with the reason, instead of failing after you have spoken.
- Make the Settings close button respond to every click on macOS, and keep the window buttons
  clear of the Settings title and of the first controls in narrow windows.
- Keep the sidebar resize handle on the sidebar's edge on macOS.
