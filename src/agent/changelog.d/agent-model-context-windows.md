### Fixed

- Use each Mycellios model's own context window and output limit. Before, DeepSeek and other
  AntSeed models shared the network's smaller default window, so a Mico with computer tools
  could stop with "This model's context window is too small".
