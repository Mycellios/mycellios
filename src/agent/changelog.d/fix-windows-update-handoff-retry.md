### Fixed

- On Windows, Restart to update no longer fails with "Could not restart. Try again." when
  Windows briefly refuses to start the update helper. The app now tries again by itself for
  about 30 seconds before it shows the error.
