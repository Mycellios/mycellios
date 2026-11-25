### Added

- Mycellios publishes its own self-host images, built from this repository for amd64 and arm64:
  `ghcr.io/mycellios/mycellios/app`, `computer` and `updater`, tagged `sha-<commit>` and `edge`
  from main, and `v<version>` for each Desktop release, which also tags its commit `v<version>`.
  The installer, the Compose files and the updater keep their current images until a later
  release moves them.
