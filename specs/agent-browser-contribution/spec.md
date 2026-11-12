# Inline browser contribution

## Scope

The Agent sidebar activates and pauses the existing signed browser worker in
place. Keep native Desktop contribution and its admission/control flow intact.
Load the browser engine only after the user activates it. Do not open a page,
window or iframe, forward account credentials, or create a second compute engine.

## Lifecycle

- Reuse src/mobile/runtime, including WebGPU/CPU validation, identity persistence,
  device-signed registration, visibility suspension and bounded work cancellation.
- Embedded initialization disables standalone update reloads and automatic resume.
- Stop on unmount or account change. Late module loading must not start compute
  after the owning control has been closed or cancelled.
- Show contribution as active only after the coordinator confirms the connection.
  Connection failure stays visible and can be retried without navigation.
- Preserve pause during preparation and prevent overlapping activation requests.

## Transport and credits

Production uses same-origin /mobile/v1 and /browser/ort/ routes. The Dev proxy
accepts only the Mycellios origin or loopback, and strips Agent cookies. An
optional src/agent/.cache/browser-coordinator-url selects a private local
coordinator for serve mode; never read that profile into production builds.

A verified browser matrix task is compute evidence, not evidence of a credit
award or multi-host AI inference. Keep credit amounts sourced from the existing
account wallet; never generate balances from worker counters or timers.

## Qualification

Run BrowserContributionControl, SidebarContribution and MycelliosCredits tests,
Agent web types/build and native mobile backend/hub tests. Separately exercise
the real browser's signed admission, a verified WebGPU/CPU task, pause and
disconnection against an isolated loopback coordinator. Do not use paid supplier
requests or customer ledger entries for this qualification. Record omitted checks.
