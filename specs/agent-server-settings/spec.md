# Agent Space settings

Personal Settings opens from the account controls. Space settings opens from
the workspace selector and identifies the Space it edits. Opening or changing
the target in settings leaves the current conversation and selected Space in
place.

## Scope

- General, memory, MCP, providers, voice and approvals reuse the corresponding
  Mycellios settings. Space model, voice and approval preferences inherit the
  account values until explicitly customized. Provider credentials remain
  account-owned.
- MCP reads, edits, tests, OAuth and assignments use the edited Space's
  authenticated client. Changing settings sections or closing the panel keeps
  the existing unsaved form confirmation.
- OpenCode is a built-in native engine when the server can discover its
  installed CLI. Only a server-authorized account and Space can select and
  execute it, and selecting it is explicit per Mico. Its ACP profile is scoped
  to the conversation and uses the OpenCode provider without host credentials.
  It reuses the existing restricted MCP bridge and cancellation path.
- On Windows x64, an authorized Space can download the managed CLI from
  Providers when its host enables `allowOpenCodeInstall` in `native-agents.json`.
  The API accepts no URL or path. It verifies the pinned upstream archive and
  binary and publishes the runtime in the host data directory. An explicit
  operator command takes precedence. The existing key-based OpenCode Zen and
  Go provider connections retain their separate account flow.

## Qualification

Check navigation scope and deep links, cross-Space MCP operations, inherited
settings, and native ACP start, tool execution, cancellation and accounting.
An isolated CLI session probe can verify protocol negotiation and model
selection without inference. Real model output requires a separate run.
