# Windows update recovery

Updates download and wait in the sidebar without blocking conversations. Only an
explicit restart opens the pending-work screen; cancellation and saved drafts
remain available. Calls stop only after the owner requests restart.

The same-user worker holds an exclusive profile update lock through backup,
installation and confirmed relaunch. A competing handoff must fail before quit.
Keep native installer checks visible and record launch separately from execution.
Windows Attachment Execution Services validates the staged attachment and applies
its execution policy before acknowledging app shutdown. Show any required prompt
on the existing app window; cancelled or blocked checks never commit a restart.
Preserve download-origin evidence and rehash the exact bytes after Windows scans
them. Launch those approved, locked bytes directly rather than repeating a hidden
shell attachment prompt after exit. Record phase timestamps and keep installation
progress responsive while waiting for the installer and the confirmed new app.
Preserve artifact hashes, account/Space acknowledgements, recovery copies and the
unsigned manual-install policy. Never kill an app to make an update pass.

First installation uses the assisted per-user NSIS wizard and Open at Finish.
Keep its directory fixed and elevation disabled. Silent updates retain the
verified same-profile relaunch, version/child-PID receipt and recovery guards.

Validate the controller/PowerShell/lock/renderer/config tests and incremental
Desktop/web types. Browser fixtures certify presentation only. Release requires
the integrated main source, immutable qualified Windows package and a real
upgrade/relaunch test; report physical installed-profile acceptance separately.
