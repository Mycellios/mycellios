# Agent visual quality

## Scope

Refine the existing shared web/Desktop frontend in the canonical checkout. Keep
accounts, balances, model routing, permissions and production unchanged. Preserve
the Geist/paper/forest system and existing capabilities. Hide technical setup
details progressively instead of removing recovery controls.

## Confirmed issues and correction

- Long select options expanded a shared dialog's grid track beyond its visible
  boundary. Its menu reached x=584 in a 320-pixel viewport. Constrain the grid,
  trigger, value and popup; keep full option labels readable when open.
- Shared dialog headings could overlap the automatic close control. Reserve
  header space without changing custom headers that own their close controls.
- Small sign-in screens retained a desktop-sized, left-aligned heading. Keep
  the form bounded and center the responsive heading.
- Unavailable-computer guidance exposed server configuration as the primary
  explanation. Show the actual capability boundary briefly and retain configuration
  instructions and copy under a closed Technical details disclosure.
- Artifact cards retained a 280-pixel minimum even where their container was
  narrower. Bound that minimum to the parent width.

## Qualification

Use actual React components with synthetic, offline account/catalog data. No
production database, model calls or user-account mutations. Review General,
Models, Voice, Approvals, Space, Memory, Usage, developer Logs, Computer and
Integrations at 360/768/1280 pixels; stress shared controls at 320/360/768.
Exercise keyboard choice/Escape, expanded forms, search/empty states, English,
Spanish, German and light/dark. Distinguish emulated touch from physical-device
testing. Evidence and commands live in `src/agent/outputs/visual-audit-20261031`.

Targeted Vitest and incremental TypeScript checks must pass locally. This work
does not publish a release, install a native update or certify every backend flow.

## November 1 follow-up

The preview selection instruction exceeded its toolbar by 7 pixels at 320 and
768-pixel viewports with the root text size enlarged to 150%. Wrap the toolbar and
give the instruction its own line; let the draft action label wrap as well.
Language entry, timezone and memory-provider choices now use the existing branded
OptionSelect with their accessible names and saved values retained.

The isolated current-source browser campaign covers ten settings/integrations
surfaces at 320, 390, 768 and 1280 pixels, expanded forms, keyboard selection,
Escape, model search, cards, and English/Spanish/German light/dark samples. All 40
layout cases and 82 browser assertions pass. The preview regression is reproduced
before and passes after at 320/390/768 with enlarged text. The three affected
component suites pass 26 tests, alongside scoped incremental TypeScript checking.
Evidence: `src/agent/outputs/visual-audit-20261101`. These are emulated Chrome
viewports and offline fixtures, not physical mobile/native-caption qualification,
real-account authentication or production deployment.
