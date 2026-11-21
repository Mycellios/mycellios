# Close a Mico's browser sessions

Status: implemented.

## Problem

Each Mico has its own Chromium profile (`.browser-profiles/chromium-bot-<sha256(botId)[0:32]>`)
on the server computers it uses, so its logins survive between tasks. Until now the only way to
sign a Mico out of every website was to delete the Mico. Owners need this when a client
relationship ends or when a site is stuck in a broken login.

## Behavior

- Mico settings → Computer → "Close browser sessions", behind a confirmation. Shown when the
  Mico uses a server computer (shared or isolated), not "This PC".
- `bots.resetBrowser` (owner only, through `repos.getBot`) calls `resetBotBrowser`:
  1. Collects the computers that can hold the profile: the Mico's current computer, its
     dedicated and cloud-fallback computers, the owner's Team Computer and its cloud fallback,
     and the Space's legacy Team Computer. Computers of kind `desktop` (the owner's PC) are
     never touched.
  2. Takes the Mico's execution lease on each Team Computer (a run that starts afterwards waits
     and is requeued), then refuses with `CONFLICT` if the Mico has an active run.
  3. On a running computer: releases the Mico's screen (stops Chromium) and deletes the profile
     through the existing contained-folder removal, retrying briefly while files are busy.
  4. On remote providers (e2b, daytona, boat, createos) also deletes the stored home copy,
     which replacement computers restore from.
  5. A stopped local computer cannot be cleaned by the server (only the computer may delete
     from a home it mounts). If it is the Mico's current computer the result says
     `computerOff: true` and the UI asks to retry when it is on.
- Audited as `credential.deleted` / `browser_session`.

## Not covered

- A stopped, local, non-current computer keeps its old profile until reset while running.
- Dedicated computers have no execution lease; a run that starts between the active-run check
  and the deletion can see a partially deleted profile. The window is a few seconds.
- Shared profiles between Micos are intentionally not offered.

## Verification

- `packages/adapters/src/browser-reset.test.ts`: lease → run check → browser stop → delete
  ordering, busy refusals, remote stored copy, sleeping local computer, legacy computer, PC
  skipped.
- `apps/web/src/components/BotBrowserReset.test.tsx`: confirmation, success, computer off,
  Mico working.
- Not run: a reset against a live provider computer.
