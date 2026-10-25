# Minimal panel screens

## Scope

Extend the approved Overview hierarchy to History, Run, Downloads and the authorized device/model/task/log/test/admin screens. Use the same production components in Storybook. Keep the existing authentication, destructive-action confirmations, enrollment, resource limits, billing and API behavior. Conversations belong to Mycellios Agent; the panel no longer contains a chat screen, composer or chat stories. Legacy chat links open Overview.

## Design

- One title, one principal task and one summary per screen.
- Show meaningful current data once; never replace unavailable measurements with invented values.
- Keep technical tables, diagnostics, secondary filters and raw samples behind concise shared disclosures.
- Keep errors, activation failures, payment verification and security warnings visible where they affect a decision.
- Use existing neutral Agent tokens, native disclosure motion and reduced-motion support.

## Verification

Review real local routes and production Storybook screens in both themes and mobile widths. Exercise read-only controls, drawers, disclosures, searches and filters without sending inference, installing a worker, altering permissions or making payments. Submit types/builds/focused tests through the shared Windows queue. Preserve preimages and report any unavailable checks.
