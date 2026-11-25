### Changed

- Self-hosted Mycellios installs and updates from this repository: the installer, the Compose
  files and the updater sidecar use the `ghcr.io/mycellios/mycellios` images and this
  repository's `v<version>` releases, and the installer fetches its files from the tag it
  installs. `bash install-images.sh --release v<version>` installs a release instead of `edge`.
  Desktop's Docker stack uses the images of its own version from this repository too.

### Self-host upgrade notes

- An install whose `.env` still names the images of the project Mycellios Agent was imported from
  keeps them until you move it. Rerunning the installer asks once (`--move-images` and
  `--keep-images` answer without asking), and the updater sidecar offers the same with
  `POST /move`. The move first checks the database and changes nothing when it records a
  migration this repository does not ship. Until it moves, the updater refuses official updates
  instead of pulling this repository's releases onto the other images.
