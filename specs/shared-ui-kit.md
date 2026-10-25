# Shared web UI kit

## Scope

Use one React implementation for repeated web controls in the landing, account,
dashboard, studios and browser worker. Storybook imports those production modules;
it must not maintain a second set of demo components. Preserve current behavior,
refs, event handlers, accessible names, native form semantics and layout hooks.

## Implementation

- Own primitives, tokens, compositions and stories under `landing/src/ui`.
- Migrate native interactive controls and repeated content primitives in production
  TSX to the kit, preserving existing classes during the migration.
- Normalize button variants, fields, spacing and focus in the kit stylesheet.
- Resolve Agent component colors and hover/selected/disabled states through
  `agent-components.css` and the semantic palette in `agent-style.css`.
- Add a source gate rejecting new native primitives outside the kit.
- Keep Storybook configuration under `landing/.storybook`; no new top-level area.
- Document both themes and enabled, disabled, loading, empty and error states.
- The default Agent profile matches Mycellios Agent's Geist Variable, compact
  controls and the approved neutral settings screenshots. The previous
  Graphite/amber design remains
  available through `?design=classic` and the Storybook Design toolbar.

## Acceptance

- The account submit button is the same Button shown in Storybook.
- No production button/input/select/textarea/label/link/card/table/heading bypasses
  the shared implementation; structural HTML and SVG remain native.
- Production typechecks, UI source gate, architecture/boundary gates and focused
  tests pass. Storybook builds and opens locally.
- Check account, sidebar, downloads and browser contribution in the real browser.
- No commit, push, production change or dependency-queue bypass.
