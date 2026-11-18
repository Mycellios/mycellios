### Added

- Hifa Store apps can ask to keep large files for each person, such as videos or
  images. This stays unavailable for now: the editor shows it as "No disponible
  por ahora" and nothing can be uploaded until a server operator turns it on.

### Self-host upgrade notes

- Apply the database migration `20261118210000_hosted_web_files` before starting
  this version. Large app files stay off unless you set
  `MYCELLIOS_HOSTED_WEB_FILES_ENABLED=true` and configure object storage
  (`OBJECT_STORAGE_*`); they are never stored on the server's local disk.
  `MYCELLIOS_HOSTED_WEB_FILE_MAX_MB` and `MYCELLIOS_HOSTED_WEB_FILES_QUOTA_MB` can
  lower the limits of 25 MB per file and 250 MB per person per app.
