# Visible This PC Mico folders

## Outcome

A Mico that works on This PC keeps its files in a folder the owner can find:
`~/Mycellios/Micos/<Mico name>`. Mico settings (This PC, Desktop only) show that
path read-only with an Open folder action. OpenBot keeps each agent's folder in
the user's home in the same way; it is a behavior reference only (PolyForm
Noncommercial), and no code or copy is taken from it.

## Where a home lives

The Desktop host resolves each Mico home in this order, keyed by
`sha256(botId)` as before:

1. The folder already recorded for that key in `<userData>/computers/mico-folders.json`.
2. The existing private home `<userData>/computers/desktop-computers/<key>`.
   Existing homes are never moved, copied or renamed.
3. Otherwise a new folder under `~/Mycellios/Micos`, chosen once and recorded
   in (1). Renaming the Mico later does not move it. If the owner deletes the
   folder, the next run creates it again at the same path.

Only requests that may create a home choose a folder. Cleanup requests
(`stop`, `destroy`, `cancelRunWork`) and isolated project-task keys never do;
task keys stay in the private folder. The visible root is computed in native
main from the OS home directory (a separate folder inside isolated performance
profiles); it is never taken from a renderer or the server. Without that root
(tests, the development-only `SANDBOX_PROVIDER=desktop`) homes stay private.

## Folder names

The server sends the Mico's display name (`botName`) with host requests of a
run; it only names a new folder and authorizes nothing. The name is NFC
normalized; characters refused by Windows, macOS or Linux, control characters
and path separators become spaces; leading/trailing dots and spaces are
dropped; Windows device names (`CON`, `NUL`, `COM1`…) get a ` Mico` suffix; the
result keeps at most 60 code points and 160 UTF-8 bytes. An empty result, or a
request without a name, uses `Mico`.

A name already used by another recorded Mico (compared without case) or by an
existing file or folder gets a short id from the key (`Writer 1a2b3c`, then a
longer id). Saved entries that are not a plain folder name are ignored.

## Settings

`desktop.computer.micoFolder(botId)` returns the Mico's folder only when:
the caller is the configured app's own main frame, PC access is on, the id is a
plain Mico id, a folder exists on disk, and the server confirms that the
current account owns the Mico in its Space. `desktop.computer.openMicoFolder`
applies the same checks and opens that folder with the system file manager.
The renderer passes a Mico id, never a path. The web app has no bridge, so the
row is hidden there, and also before the folder exists.

## Not in scope

- Team (Shared) mode is unchanged. On This PC each Mico already has its own
  home keyed by its id, so a `~/Mycellios/Compartido` folder would not map onto
  the existing `bots/<id>` and `shared/` layout without moving data.
- No migration of existing private homes.

## Verification

- `packages/adapters/src/mico-folders.test.ts`: names, collisions, stable
  record, existing-home precedence, and the host transport end to end.
- `apps/desktop/src/mico-folder-ipc.test.ts`: IPC admission.
- `apps/web/src/components/MicoPcFolder.test.tsx`: read-only row and hiding.
- Physical installed-Desktop acceptance on Windows, macOS and Linux is separate.
