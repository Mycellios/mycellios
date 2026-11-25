### Added

- Install Codex, Claude Code or OpenCode on your PC from the chat model menu when it is missing.
  The menu shows the version, the npm package it comes from and the download size first. Mycellios
  checks the download against the hash its maker published before it runs, needs no administrator
  rights and leaves any copy you installed yourself as it is.

### Changed

- When your PC has its own copy of Codex, Claude Code or OpenCode and one that Mycellios installed,
  Micos use yours if it is the same version or newer.

### Fixed

- On macOS and Linux, Mycellios opened from Finder or an app launcher now also finds the coding
  programs your terminal finds (for example ones installed with Homebrew or npm). Before, they
  showed as not installed.
