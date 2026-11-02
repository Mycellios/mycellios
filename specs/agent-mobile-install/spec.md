# Agent mobile installation invitation

## Scope

Add a small, dismissible mobile invitation to the shared Agent sidebar, following
the interaction pattern supplied by the user. Reuse the existing Mycellios design
system. No production changes, store release, account mutation or inference.

## Behavior

- Keep the card outside the scrolling roster, above the separate Desktop offer.
- Open a bounded installation guide with iPhone/iPad and Android instructions.
- Support copying or opening the Agent entry URL without losing the current chat.
  Loopback development origins share the public entry URL; real servers retain
  their own Agent namespace. Never share a private chat or authorization URL.
- Persist dismissal in this browser. Keep the guide reachable from the account
  menu and use a compact icon when the sidebar is collapsed.
- Hide the invitation in an installed mobile PWA. Desktop PWAs may still promote
  the mobile app. This guide describes the existing web app, not store availability.
- Preserve Desktop updates, contribution controls, accounts and Credits.

## Local qualification

33 affected unit tests pass. Scoped incremental TypeScript and component lint
pass. An offline fixture of the actual shared footer passes 12 browser cases:
320/390/1280 pixels, English/Spanish and light/dark. The checks cover bounded
layout, platform switching, Escape, persistent dismissal and reopening from the
account menu. No physical iPhone/Android installation was performed.

Evidence: `src/agent/outputs/mobile-card-20261102/`.

## Hosted publication

The follow-up also makes the existing update notice visible in the expanded
sidebar. One global web prompt moves into its slot; a missing/collapsed sidebar
keeps the floating fallback. Draft/call/attachment guards and retry behavior remain
owned by the existing update tracker. Native progress is displayed only when the
bridge supplies a measured percentage.

64 focused tests, scoped incremental TypeScript, the local production build and
26 isolated browser cases pass. The published candidate is an immutable overlay
on the verified production frontend, based on synchronized main
`2e7e9205438ccf53e4bcc990afc7ae920b587c73`. Its 425 original first-party source-map
inputs were checked: 422 remain unchanged, three update/footer modules change,
and two new components are added. Only 19 Spanish translation blocks are appended.
The global architecture gate still reports unrelated existing cycles/module sizes.

Published web build `20261102061307`, release
`323240a20f0669769071a6ad8f51c0535185513dcf5bdff62494035c886a71af`.
Private Nginx qualification and public checks pass, including 14 entry assets,
readiness, authentication discovery and protected RPC rejection. Existing asset
bytes and surrounding HTML remain preserved. API/worker/inference containers and
balances were not changed. The real browser reaches the primary sign-in screen;
no new account sign-in or physical phone installation was performed.

This does not rebuild native installers, merge or push the worktree. Rollback
configuration and artifacts remain in the release directory. Detailed receipts:
`src/agent/outputs/mobile-card-20261102/release/`.
