### Fixed

- The Windows installer no longer fails a first installation on PCs where PowerShell scripts are
  restricted (common on work laptops). With nothing installed yet, it installs without the update
  safety copy, which only matters when replacing an existing version.
- Running the Windows installer while Mycellios is still open now asks you to close it first, instead
  of saying the update could not be prepared. Nothing was changed in either case.
