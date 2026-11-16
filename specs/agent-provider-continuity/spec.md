# Optional Mycellios model exploration

## Problem and existing behavior

Subscription authentication, account quota reads, model selection and per-Mico
provider settings already exist. Reuse them. When a personal provider is selected,
make the optional credit-funded catalog easy to find without changing payment or
running the previous message again.

## Behavior

- The current picker offers “Explore models with my credits” when viewing a
  personal provider. This selects only the Mycellios catalog tab.
- An existing Mycellios connection uses its owned canonical catalog. Otherwise
  the existing explicit account connection flow stays available.
- Exploration never connects, updates models, changes account defaults, starts
  inference, automatically switches payer or retries a task.
- Selecting a model still passes existing connection, pricing and permission
  checks. The Mico keeps its identity, threads, context boundaries, memory and
  computer/files. Different providers can have different context capabilities;
  preservation of stored history does not imply transfer of private CLI sessions.
- Preserve personal providers, native executors, effort/Fast settings and
  read-only quota behavior. Do not add a second authentication system.
- Keep the current shared controls, English and Spanish copy, and narrow layouts.

## Qualification

- Scoped picker tests cover Pi/native exploration without connecting or saving.
- Real picker browser fixtures cover connected and unconnected credit catalogs,
  personal provider retention, desktop/mobile and dark mode. Block external
  requests and unexpected RPC calls; no live identity, wallet or inference.
- Isolated PostgreSQL exercises the same model persistence used by bots.update,
  asserting unchanged histories, context boundaries, memory, computer/home files,
  profile identity, runs and usage after two model changes. This qualifies
  persistence, not paid inference or a provider's response quality.
- CI runs the existing scoped model/auth validation and workspace gates. No
  deployment, paid model calls or new automatic fallback is included.
