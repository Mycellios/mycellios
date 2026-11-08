# Trial Spore rewards

Every registered Mycellios Agent account has 100 welcome Spore plus one Spore
for each complete million of processed tokens. The usage screen shows the
balance, its two components and progress toward the next Spore.

- Existing accounts and retained usage qualify. The reward uses all canonical
  account-owned usage records across Spaces, providers and operation kinds.
- A reported total is authoritative. When absent, count a complete set of
  input, output, cache-read and cache-write buckets. Incomplete records do not
  award an estimated token count. Reasoning and hourly writes are subsets.
- The authenticated API derives the balance from the canonical records.
  Reopening the app, changing Space or retrying an already recorded model
  call does not create an additional reward.
- Trial Spore has no monetary value. It is separate from Credits and the
  blockchain token. There is no transfer, conversion or redemption.

Verify the PostgreSQL threshold, multiple Spaces, owner isolation, incomplete
usage and duplicate calls. Typecheck the account API and both signup surfaces.
