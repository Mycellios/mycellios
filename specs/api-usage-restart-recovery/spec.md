# Recover zero-token reservations after coordinator restart

Job recovery marks interrupted jobs failed before public admission starts, but
pending API usage can still occupy all account slots. After job recovery and
before serving, atomically settle only pending usage with zero reserved tokens
whose job is failed with `coordinator_restarted` and zero input/output tokens.
Keep balances, counters, limits, funding policy and jobs unchanged. Do not infer
settlement for missing/unattached jobs, other failures, completed work, nonzero
token metrics or refund-bearing reservations. The operation is idempotent.

Verify real persistent coordinator restart and restored admission, repeated
settlement, protected reservations and unchanged account state. Keep PostgreSQL
startup ordering and all production overlays when promoting this component.
