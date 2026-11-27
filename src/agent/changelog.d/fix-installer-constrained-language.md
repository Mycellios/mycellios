### Fixed

- The Windows installer can now update Mycellios on PCs whose security policy restricts
  PowerShell scripts (common on work laptops), keeping the safety copy that restores the previous
  version if an update fails. On those PCs, update by downloading the installer: the in-app
  Restart cannot run there and offers the download link instead.
