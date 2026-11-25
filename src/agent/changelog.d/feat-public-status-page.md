### Added

- The server answers `GET /api/v1/status` with only `{"status":"ok"}` or
  `{"status":"degraded"}`, from the same database check as `/ready` and with no version or
  other details, so a status page or uptime monitor can tell whether Agent works. `/health`
  is unchanged.
