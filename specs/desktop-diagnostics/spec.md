# Desktop execution diagnostics

Keep a simple user-facing interruption notice while retaining a bounded, safe cause
and the operation correlation needed to investigate desktop execution failures.
Extend the existing logger, crash observer and relay; do not introduce analytics,
new credentials, command replay, a database migration or a competing crash reporter.

## Contract

- Relay failures carry fixed reason codes, phase/stage, claimed status and the
  operation UUID. Older native hosts remain readable through fixed-string mapping.
- Persist only a validated diagnostic suffix with the existing uncertain-run error.
  Its presence must never make an uncertain command eligible for automatic retry.
- Native diagnostics retain metadata only: no request bodies, command arguments,
  stdout, cookies, URLs, account names or raw exception text. Exception names and
  OS error codes use allowlists. Unknown failures remain explicitly unknown.
- Local files rotate and bound pending writes. Logging failures cannot interrupt
  work. Record process/power/quit events and a previous-session heartbeat marker.
- Native menu copy and chat copy produce safe JSON with versioned schema and
  correlation metadata; clipboard denial remains actionable and never retries work.

## Qualification

Offline regressions must cover exact reason propagation and legacy fallback,
privacy/injection rejection, uncertain retry fences, complete stream termination,
rotation/queue bounds, restart evidence, copy success/failure and native relay
delivery. Run incremental native types and affected tests through compilar.ps1.
Physical crashes/suspension and installed application activation are separate from
these local source tests. No inference, paid calls or deployment is needed.
