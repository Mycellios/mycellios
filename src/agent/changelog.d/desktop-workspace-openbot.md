### Fixed

- A Mico working on your PC no longer stops when its workspace holds a large file. Its
  workspace now belongs to the PC: Mycellios only copies the saved files into a new PC
  workspace, sends large files in verified pieces, and never copies `.git`, `node_modules`,
  `.env` files, private keys or archives between machines.
- If preparing the Mico's computer fails after the task reached your PC, the chat now says
  why, instead of retrying it and showing a misleading "connection changed" error.
- Desktop no longer reports finished operations as interrupted.
