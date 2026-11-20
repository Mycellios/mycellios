### Security

- Desktop now protects the local server's identity, which holds the local database password and the
  key that encrypts saved conversations, with the system's secret store: Windows DPAPI, the macOS
  Keychain or the Linux keyring. Before, it was a plain file in the profile folder. Existing
  installations are converted on the next start without changing any data. On Linux without a
  keyring, the key stays in a file only your user can read, as before.
