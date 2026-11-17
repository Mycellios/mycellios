# Unreleased notes

Each pull request that changes Mycellios Desktop or Agent (`src/agent`) writes its release notes in its own file here, so two pull requests never change
the same lines of `CHANGELOG.md`. Name the file after the branch, with `-` for `/`:
`changelog.d/fix-web-empty-bubbles.md`.

Use the groups and item rules of [the release notes](../../../docs/DEVELOPMENT.md#desktop-release-notes). A
file can have more than one group:

```md
### Fixed

- Show the full server name in the mobile server list. Before, the name stopped after 20
  characters.
```

The daily `desktop-auto-release` workflow (or `npm run release:patch`, `release:minor`, `release:major` by hand) moves the items of every file into the new
version section of `CHANGELOG.md`, in the order that the pull requests merged, and deletes the files.
The `changelog` workflow checks each file. A pull request with no change that a user or self-hoster
can see gets the `no-changelog` label.

The groups decide the next version: an item under `### Breaking changes` makes it a major
version, notes only under `### Fixed` or `### Security` make it a patch, anything else a minor
version. Use `### Breaking changes` only when an existing installation cannot take the release
without manual work, or when support for a platform, protocol or older server is dropped.
