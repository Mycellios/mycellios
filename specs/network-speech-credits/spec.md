# Contribution-funded network speech

The managed Agent voice route previously selected legacy Kokoro CPU replicas.
They could return valid audio but had no attributable physical execution stage,
so contribution settlement failed after inference. Network voice must select
operator-approved, authenticated speech worker identities through the existing
trusted-only/pinned-edge request policy. The scheduler already revalidates this
policy at dispatch and fallback. Missing/invalid deployment placement fails before
inference. Users cannot set placement through the voice HTTP body.

MYCELLIOS_NETWORK_SPEECH_IDENTITIES is a deployment-only comma-separated identity
list, bounded by the existing request privacy contract. Before adding a target,
verify its current physical GPU owner, source build, model, activation and native
three-lease qualification. Maintain existing owner pause, capacity reservations,
resource limits, daily qualification attempt caps and signed economic evidence.
No fallback funding, credit minting, balances, prices or ledger history changes.

Verification includes configuration parsing, request placement and no-retry
regressions, account/Mico/Space admission tests, plus real managed voice output and
its usage/hold/settlement records. A single physical GPU is sufficient for a speech
replica; it does not qualify a multi-computer pipeline. Unavailable physical tests
must remain explicitly unqualified.

The operator-only `apps/api/src/cli/verify-network-voice.ts` is built explicitly
with the normal server bundler. It requires `--confirm-credit-use`, a private JSON
target containing `userId`, `spaceId`, `botId`, `language`, and a private output
directory. It checks that Mico's ownership under the tenant context, loads only
the account's canonical connection and uses the normal bounded speech renderer.
Never run it as routine CI or against a third-party account. Its WAV/job receipt
must be correlated with normal API usage and a balanced economic settlement;
the CLI itself never writes ledger entries or adjusts balances.
