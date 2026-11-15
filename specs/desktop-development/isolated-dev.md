# Isolated Mycellios Dev

This supersedes the real-account renderer-only launcher in `spec.md`. Development
uses the same architecture as OpenBot's worktree launcher, adapted to npm and the
existing Mycellios embedded local stack. The normal chat remains the editing chat.

- Developer mode exposes Open Mycellios Dev in the chat tools on Desktop only.
  Native main admits the current individual main chat, computer consent, account
  and Space before binding its preserved private source copy. Task/group chats
  and a Mico already attached to another project are not silently repurposed.
- The source copy survives closing Dev and upgrading the normal application.
  Copying never includes credentials, databases, dependency links or outputs.
- A canonical source path determines the Dev profile identity and branch color.
  Each source owns independent database, cookies, ports and subprocesses. The
  developer launcher never reads `.env`, copies normal cookies, or imports paid
  provider credentials. A local throwaway account is provisioned for the preview.
- Renderer changes use Vite HMR. Backend/native changes require closing and
  reopening Dev; the launcher rebuilds the native entry before opening it.
- One authenticated loopback control endpoint per source handles duplicate
  launches. Never adopt or terminate a process merely because its port/PID matches.
  Closing the child application or its parent stops the owned stack. Source and
  profile persist. Failed startup clears only its own lock and reports failure.
- Locked dependencies are prepared only when the workspace input fingerprint
  changes, and a successful preparation is stamped. npm, Node and commands are
  selected by native main or the developer CLI, never by renderer parameters.

Checks: Node tests for identity, environment, stamps and control ownership;
Desktop tests for admission/session changes and IPC; focused web tests for the
launch control. A running stack check must separately verify web HMR, API, worker,
profile isolation and shutdown; mocked subprocesses do not establish native QA.
