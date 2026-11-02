# Built-in Mycellios provider

Mycellios is the first-party provider in Agent settings. Official account sign-in
provides account-scoped funding without asking the user for an API key. External
providers remain optional and an explicitly saved main or Mico model is preserved.

- Show Mycellios first, including before the member creates a model connection.
- Read the authenticated network catalog using Credit funding; offer chat models,
  excluding explicitly unavailable/ineligible models and media services. Passive
  discovery does not create credentials or run inference.
- Connection setup reuses an owned official connection. New internal credentials
  remain encrypted server-side; never substitute an operator or another user's key.
- A new account with no main-model choice defaults to an available network model;
  prefer the deployment recommendation only while actually listed. Preserve
  existing roles, enabled IDs, limits and balances on reconnection.
- The main-model picker owns model selection. The provider row explains Credits
  instead of exposing generic key/name/disconnect fields. Keep external connections.

Validation: focused API/catalog/funding and UI tests, incremental typecheck and
local visual review. A local implementation does not constitute deployment or
live credit-settlement evidence. No promotion is authorized by this spec.


Production qualification (2026-11-01): the provider and live catalog were inspected
with an authenticated production account. The deployed adapter completed a native
GPU request with actual Credit settlement, unchanged saved limits, no external
fallback and no pending reservation. The final adapter check ran server-side after
Windows locked; it is not a repeated full-chat UI check. Immutable API/web/worker
receipts identify the published artifacts; source changes remain uncommitted.
