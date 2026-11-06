# Compact Windows Desktop updates

## Goal and boundaries

Replace the 0.3.18 package's 87,283 physical files (80,987 in the local server)
with immutable archives and the native packages that require real filesystem
paths. Keep cloud and offline-local modes, PostgreSQL/migrations, voice, Apps,
development sources/tools, runtime contribution and all licenses. Never change
profile locations, draft keys, task leases, native-runtime pins or unsigned
preview update consent. Manu's open PR and branch are excluded.

## Implementation and acceptance

- Archive local-server JavaScript and development resources. Preserve every
  source file either inside an archive or as an external native-package asset;
  write a package inventory and enforce a physical-file ceiling.
- Resolve modules between the archive and external native packages only within
  that immutable resource root. Keep native executables and PostgreSQL share
  files at real paths; do not unpack the entire server on first launch.
- For a legacy per-user installation, retain a recoverable installation snapshot
  by a same-volume directory rename before the standard old uninstaller runs.
  Keep its original uninstaller available at the expected path. Refuse running
  apps, unsafe/reparse roots and incomplete snapshots. Journal preparation and
  commit, retain installation registry/shortcut recovery and restore on failure.
  Profile data is outside this transaction and must never be replaced or cleared.
- Exercise the archived server through Electron's actual utility process and
  Node-mode migration CLI: fresh isolated PostgreSQL, authenticated local RPC,
  persisted fixture state and restart. Verify development source copying and npm
  from their archives, native package resolution and a child Node process.
- Measure fresh install and legacy-to-compact upgrade of the real Windows
  installer, including the old uninstaller; target less than 60 seconds on the
  measured machine. A timing miss is a miss, not a passing preparation receipt.
  The installed 0.3.18 client's old pre-install backup can still take additional
  time; distinguish that preparation from measured installer execution.
- Preserve fixture drafts, queued tasks, account/Space fences and the existing
  restart/update-specific tests. No production account/model is a fixture.
- Publish a new immutable Desktop version only after updated-main integration,
  required checks, a real build, artifact identity and release health checks.

## Validation route

Remote Windows CI is the primary build/qualification route. Local bounded
Electron probes provide feedback only. Physical-PC acceptance is reported
separately from hosted-runner timing. Existing production data and the installed
0.3.18 profile remain untouched during isolated qualification.
