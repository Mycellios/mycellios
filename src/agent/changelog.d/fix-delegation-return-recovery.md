### Fixed

- A Mico that hands work to another Mico now comes back to you with the result even when an
  update or a lost PC connection stops the turn in which it reads that result. That turn starts
  again on its own, up to three times over about eight minutes, and the Mico checks what it
  already did before going on.
  Before, the conversation stopped there without an answer.
- When the other Mico could not do the work, the Mico that asked now knows why, for example
  that several PCs are connected and none was chosen for that Mico, and can tell you. Before, it
  only knew that the work had failed.
