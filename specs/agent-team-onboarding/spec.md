# First-run Mico teams

## Outcome

A new empty account can describe its work, choose a role, audience and first
activity, review a small team and create its profiles. Role templates provide a
shortcut. Users can instead create one Mico, import an existing one or configure
their own provider. Existing accounts and Spaces retain their agents and settings.

## Boundaries

- Reuse the signed-in Mycellios connection and canonical credit admission. A
  configured provider is preserved; an account read failure cannot select a payer.
- Setup does not run inference, send messages or grant more credits. All team
  profiles suppress automatic greetings. Starting work uses the normal composer.
- Structured answers select templates without classifying prose or making paid
  planning calls. Free-form intent becomes bounded, reviewable instructions.
- Reuse Space-scoped spawn keys for interrupted and concurrent creation. Never
  overwrite existing agents or replace a model, chat, folder or credential.
- The profile-only endpoint requires the expected account and checks it before
  writing. Setup pins the Space client, aborts pending work on leaving and stops
  subsequent profile writes; already committed profiles remain resumable.
- An explicitly selected installed account applies to every new proposed role;
  preserve the separate single-Mico path. Do not connect Mycellios as a hidden
  replacement for that account. Existing profiles are never overwritten on retry.

## Qualification

Focused contracts, API intro suppression, interrupted team creation, translations
and UI tests run offline. A browser fixture renders the actual onboarding page,
intercepts every RPC, blocks external requests, checks current-provider retention,
Mycellios discovery failure, retry without duplicates and mobile/Spanish layouts.
It produces screenshots for PR review. Fixture results do not qualify live models,
real account credit balances or paid inference. No production deployment is part
of this change.
