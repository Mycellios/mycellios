### Added

- With developer mode on, the Mycellios Dev entry shows its state: the current step and
  elapsed time while it prepares, and "Mycellios Dev is running" once it is open. A stop
  button ends it, and a logs button shows its recent output.

### Fixed

- Opening Mycellios Dev for the first time no longer stops after 10 minutes while it
  installs dependencies, which made every attempt start the installation again.
- Opening Mycellios Dev again from the same chat while it prepares joins that launch
  instead of failing.
- Mycellios Dev no longer reinstalls a checkout's dependencies only because Desktop and the
  terminal use different patch versions of Node.
