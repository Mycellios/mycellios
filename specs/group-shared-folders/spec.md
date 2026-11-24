# Group shared folders

## Outcome

A group of Micos can work on one project together. In Group settings → Folders the owner adds
up to 8 folders from their PC with Mycellios Desktop's own folder picker. Every member that
works on This PC, on that PC, can then read and change files and run commands in those folders
during its turns in the group. Members on other computers are told plainly that they cannot
reach them, and the settings list says which members can and which cannot.

The reference product lets a group chat add up to 8 folders that all its agents can change and
run commands in. It is a behavior reference only (PolyForm Noncommercial): no code, prompt or
label is taken from it, and every text here is written for Mycellios.

## Where the folders live

Group members can run on different computers: This PC (`dedicated`, the owner's Desktop host),
an isolated server computer per Mico, or a shared Team computer. Only the PC holds the
owner's folders, and Mycellios never moves a grant between computers. So:

- A folder is always a folder on the owner's PC, chosen with the native picker in Desktop.
- The server keeps an opaque folder id and a display name per group folder, never a path.
- Only members whose computer is This PC (`dedicated`) and whose turn runs on the PC that
  granted the folder can use it. The existing multi-PC routing
  (`specs/desktop-mico-ownership/spec.md`) decides that PC; a member routed to another PC
  sees the folder as not reachable.
- Isolated and Team server computers never receive owner folders. There is no safe existing
  mechanism to mount a PC folder into a server computer, and copying files would silently
  diverge from the original, so this is out of scope (see Not in scope).

## Data model

Additive migration `20261124120000_group_shared_folders`:

- New table `chat_group_folders` (`id`, `groupId` → `chat_groups` ON DELETE CASCADE,
  `spaceId`, `userId`, `folderId`, `name`, `createdAt`), unique on (`groupId`, `folderId`),
  indexed on (`spaceId`, `userId`), with the usual tenant and system row-level security
  policies.
- `folderId` is `HMAC-SHA256(host credential, ["group-folder", scope, groupId, realpath])`
  computed by native main, where scope is (server, account, Space). It reveals nothing about the
  path and is stable when the same folder is chosen again on the same PC.
- No existing column changes. The previous release never reads the table, so both releases
  run side by side; rolling back leaves only unused rows.

## Authorization

Server (`groups.folders`, `groups.addFolder`, `groups.removeFolder`):

- Every call is scoped to the signed-in user's own group in the current Space, through the same
  owner/Space filters as the rest of `groups.*`. Another user, Space or group gets "not found".
- Adding and removing run under the group's row lock (`lockOwnedGroup`). Adding the same id
  again returns the existing row; a ninth folder is refused (`BAD_REQUEST`).
- Archived groups cannot list or add folders. Deleting a group deletes its folders.

Desktop (native main, `group-folder-ipc.ts`):

- The renderer names a group, never a path. `chooseGroupFolder(groupId, folderId?)` requires the
  configured app's main frame, PC access already granted (the renderer asks first through the
  existing `requestAccess` consent), and a server answer from `groups.folders` proving the
  signed-in account owns the group in the selected Space (and, for the cloud host, that the
  bound account and Space match). It then opens the native picker, resolves the real path,
  rechecks the session and grants the folder on the host. With a `folderId` it accepts only the
  same folder again (Connect after a restart).
- The host refuses the file-system root and the home folder, and keeps at most 8 grants per
  group. Grants live in memory like the existing ordinary folder grants: Desktop restarts,
  account changes and revoking PC access clear them. A revoked or removed grant is gone at once.
- `groupFolders(groupId)` lists only grants made for the current server/account/Space scope.

Runs (`packages/adapters/src/group-folders.ts`, executor):

- A member's turn carries the group's folder ids to its PC only when it runs in the group's own
  thread, the run's owner/Space own the unarchived group, the Mico is an active member, the run
  is not a project task conversation, and its computer is This PC (`desktop`, `dedicated`).
  A Mico's own chat, routines, side tasks and other groups never carry them.
- The ids are read again before every computer tool call, so removing a folder, removing the
  member or archiving the group takes effect inside a running turn. Removing a member already
  cancels its running turns in the group.
- The PC grants a request only the intersection of the ids the server names and the ids it holds
  for that group. Unknown, removed or foreign ids are unreachable; paths never come from the
  server or the renderer.

## Tools and paths

- `environment` reports `groupFolders` (id, label, native path) for the granted folders. Each
  folder is mounted in file tools as `group/<label>/…`, where the label is the folder name made
  into one safe path segment and numbered on collision. `list_files group` lists them.
- Commands may use `group/<label>` (or the native path) as their working directory; the host
  resolves it inside that folder and refuses a working directory that escapes it. Shell commands
  keep the OS user's permissions: this is not an OS sandbox, exactly as for ordinary folders.
- Members read a short instruction naming the folders they can use and the ones they cannot
  reach. A member that cannot reach a folder is told to say so instead of looking elsewhere.
- Native coding engines (Codex, Claude Code, OpenCode) running on the PC get the same
  instruction with native paths; they use their own file access under the same OS permissions.

## Concurrent edits

Several members may work in the same folder at once (for example after `@everyone`). Following
the shared-draft idea of `specs/mico-team-build/spec.md`:

- `edit_file` in a shared folder sends the SHA-256 of the content it read. The PC applies the
  write only while the file still has that content, serializing writes per file, so two edits
  made from the same version cannot both land. The refused member is told to read the file again.
  Text is never merged automatically.
- `write_file` replaces a whole file and is serialized per file but has no content check.
- Commands are not serialized. The instruction asks members to agree who edits which files (the
  lead assigns them), to prefer `edit_file` for existing files and never to undo another
  member's work without asking.

## UI

Group settings shows a Folders section below Save (folder changes apply at once):

- The group's folders by name, with "{count}/8", and the line "Micos of this group on This PC can
  change files and run commands in these folders."
- On Desktop: "Add folder" (disabled at 8) opens the PC access consent if needed and then the
  native picker. A folder this PC does not grant now shows "Not connected on this PC" and
  "Connect", which accepts only the same folder. Removing a folder also withdraws this PC's
  grant. If the server refuses a new folder, the PC grant is withdrawn again.
- On the web: the list and removal only, with "Add folders from Mycellios Desktop."
- Below the list: "Can use them: …" (members on This PC) and "Can't reach them (not on This
  PC): …". With several PCs, a This PC member routed to another PC still cannot reach a folder;
  its turn says so.

## Not in scope

- Folders on server computers (isolated or Team). Copying or syncing a PC folder into a server
  computer would create a diverging copy; a future slice needs its own mount and consent design.
- "On a joined server, an owner or an admin can choose folders on the server": Mycellios groups
  belong to one person in one Space, so there are no group admins. Server-side folders for
  self-hosted servers need a separate design.
- Grants that survive a Desktop restart. They follow the existing session-scoped rule for
  ordinary folder grants; Connect restores them. Persisting them is a later decision.
- Team (Shared) mode on This PC, and project task conversations, keep their own workspaces.
- Command-level locking, automatic merges, per-file ownership enforcement.

## Remaining slices

1. Durable PC grants (private, consent-bound storage, cleared on revoke), if wanted.
2. Showing which PC holds each folder when several PCs are connected.
3. Shared folders on Team computers, if a safe mount exists.

## Verification

- `packages/adapters/src/host-group-folders.test.ts`: real host server over HTTP — grants,
  labels, ids the server names, other group/no group/own chat refused, revocation, PC access
  revocation, the 8-folder limit, command working directory and escape, and the content check
  with concurrent edits.
- `packages/adapters/src/group-folders.test.ts`: which runs carry folder ids, refresh before
  tool calls, instruction text.
- `apps/desktop/src/group-folder-ipc.test.ts`: IPC admission, scope change, same-folder
  reconnect, cancelled picker, scope-filtered listing, removal.
- `apps/web/src/components/GroupFolders.test.tsx`: web and Desktop states, add/connect/remove,
  withdrawal when the server refuses, consent declined, limit.
- `node --import tsx scripts/verify-group-folders-db.ts` on a disposable loopback PostgreSQL
  cluster: the migration applies on the published schema without drift, row-level security,
  owner/Space/group isolation, the limit under concurrency, idempotent add, member and archive
  rules for runs, and cascade on group deletion.
- Physical installed-Desktop acceptance (picking real folders on Windows, macOS and Linux, two
  This PC Micos editing one folder in a real group turn, a second PC) is separate and not
  qualified by these fixtures.
