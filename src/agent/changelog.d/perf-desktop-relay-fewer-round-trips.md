### Fixed

- Micos that work on your PC wait less between steps: a finished model reply no longer sends an
  extra cancel to the server, and checkpoint and tool-completion notices no longer wait for a reply.
  This removes about one server round trip per model call and two per tool call.