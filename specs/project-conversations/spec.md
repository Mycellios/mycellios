# Projects and parallel conversations

## Scope

Local-only extension of the shared Agent UI. A project owns a collection of
independent conversations; a conversation uses an existing Mico. Ordinary Mico
chats, credentials, balances and computer assignment remain unchanged.

Projects appear as a compact, collapsible sidebar group. Creating a project and
starting a conversation use the existing controls and thread routing. The review
panel and composer remain shared. No new editor or terminal is introduced here.

## Boundaries

- Persist project names and conversation ownership in the authenticated owner/Space.
  Native repository paths never enter the cloud metadata or renderer requests.
- Reuse task threads, model selection, scoped drafts, events and run controls.
- Desktop Micos can open an ordinary local directory for direct file and command
  work. A Git root with an initial commit also offers a branch task. It uses the
  selected repository on the same Desktop without opening a second picker.
  Ordinary folder grants last for the native session. Repository bindings are
  stored on the device once a task is prepared.
- Explicit native folder selection registers a Git repository once per account,
  server and project. Each conversation gets its own named branch and worktree.
  Existing files, dirty changes and the source branch are never reset or copied.
- Distinct worktrees can execute concurrently; a project binding never permits
  unscoped operations or access from another Mico/account/thread. Old native builds
  refuse project execution rather than silently using the main workspace.
- Parallel command execution on a Team Desktop uses a distinct computer lease
  per conversation, after checking owned project metadata and the exact native
  worktree-v1 binding. Same-conversation runs still serialize. The shared screen
  and page-browser tools remain excluded; previews keep their conversation key.
  Ordinary/dedicated/legacy runs retain their existing lease behavior.
- Permission revocation invalidates native bindings; stopping one conversation
  must not terminate another conversation's commands. No automatic integration.

## Verification

Focused API ownership/idempotency tests, native real-Git worktree and concurrent
file/command fixtures, incremental typechecks, isolated PostgreSQL acceptance and
browser checks at desktop/mobile sizes. All fixtures stay off production and do
not invoke inference on the development PC. Record demonstrated limits in the
canonical status document; local fixtures are not live-provider acceptance.

The opt-in `src/agent/scripts/verify-projects-desktop-real.ts` qualifies a real
subscription model through Electron, the native bridge and the real local API.
It creates its own profile, account, database and example Git repository. Two
conversations on the same Mico implement different modules and execute unchanged
tests, held at a shared barrier until both test processes arrive. Its receipts
must prove overlapping test execution, separate worktrees and preserved dirty
source files. Fixture permission setup is preauthorized; this does not qualify
the live permission dialog, a production account or a public installer.

Qualification passed on 2026-11-05 using GPT-6.1 Sol remotely, two independent
native worktrees and two actual test processes synchronized at a shared barrier.
Both terminal exits were 0; tests and original dirty source files were unchanged.
The private database uses explicit UTF8. Native project path mapping does not
prepend the ordinary Team Mico folder; the persisted computer assignment and
authorization remain unchanged. See the canonical status document for evidence
and limits. No production change is part of this acceptance.
