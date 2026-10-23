# Capacity and route dispatch hardening

Implement independently from the c0mpute review at 4ad6a341a1c76d871cc3603d875b18c147a550d8.
No upstream code is copied. Reuse Mycellios Scheduler, measured runtime links,
capacity/evidence checks, exact-model standby policy and immutable checkpoints.

Correct observed gaps: cached affinity must use fresh costs and measured links;
all bounded complete pipeline alternatives must be considered with their return
link and policy; evidence uses one scheduling timestamp; primary dispatch must
recheck current eligibility before assigning a lease, as standby dispatch does.

Keep accepted request bytes, models, deadlines, owner memory/concurrency/CPU
limits and deterministic recovery semantics. No prompt trimming, weaker evidence,
new resource grants, timeout increases or automatic retries of uncertain forwards.
Existing Kokoro and embedding migration resources/routes remain untouched.

Verify the SAME regressions against unmodified main and candidate in isolated CI.
Run structure/architecture/typecheck and scheduler, route-policy, failover,
capacity, Kokoro and optional embedding protocol regression checks. Model-free
results prove the tested admission/control behavior, not physical WAN speedup.
Record baseline, candidate digest, scenario outcomes and limitations in outputs.
Do not publish or commit without explicit authorization.
