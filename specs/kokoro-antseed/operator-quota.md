# Operator-funded inference quota

The seller's dedicated Mycellios API key must keep serving the operator-owned
Kokoro fleet when the account starter quota is exhausted. Do not mint credits,
reuse administrative tokens, disable authentication, or exempt unrelated keys/models.

An explicit server-side key-ID/model allowlist funds only that integration.
Reservations consume no account tokens but retain authentication, revocation,
session ownership, rate/concurrency limits and exact actual usage counters.
Persist each funding decision separately from the ephemeral configuration so
completion/failure/restart never charges or refunds tokens not reserved.
No exemption is enabled by default. The operator remains responsible for funding
the configured model route. This is not automatic free access to third-party compute.

Verify zero-balance admission, unrelated-key/model rejection, limits, revocation,
restart completion and physical paid AntSeed delivery without reducing account quota.
Update the seller price to USD 6/M input (cached input identical), zero output;
retain the existing identity and unrelated services. Verify buyer-authorized usage
and actual on-chain USDC settlement separately from ANTS reward eligibility.
