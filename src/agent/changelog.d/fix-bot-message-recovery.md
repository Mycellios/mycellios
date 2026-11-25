### Fixed

- When one Mico asks another for something, an update or a lost PC connection no longer ends the
  exchange. If the turn of the Mico doing the work stops halfway, it starts again on its own, up
  to three times over about eight minutes, and the Mico that asked keeps waiting for the answer
  instead of being told it failed. The same happens to the turn in which the Mico that asked
  tells you the answer. Each Mico checks what it already did before going on. Before, the
  request failed at once or the answer never reached you.
