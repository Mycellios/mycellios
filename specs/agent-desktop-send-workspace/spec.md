# Preserve native workspace admission during sends

Desktop creates an owner/server/bot-scoped native folder when connecting the
agent. A chat send must not switch the server's team/dedicated computer mode.
That switch can fail when a new agent's automatic introduction is waiting for an
answer, after native connection has already changed the placeholder kind to
desktop. Preserve the owner's existing assignment and active work instead.

Keep authenticated bot reads, Space headers, compare-and-set instruction updates,
native consent/binding/connected checks, cancellation and draft retention. Never
retry a conflicting instruction write, bypass an access refusal, submit the user's
draft automatically or fall back to an unbound cloud send.

Verify native-computer-workspace, native-computer-execution and Desktop folder
isolation tests; qualify the installed UI with the affected draft preserved. No
API or worker deployment is necessary for this client-only repair.
