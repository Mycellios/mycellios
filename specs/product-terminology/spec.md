# Product terminology

Approved naming: Spore = official token; Credits = internal currency, 10.00 USD paid top-up = 10.00 Credits; Mico/Micos = user agents.

Preserve micro-unit precision, existing balances, ledger/API identifiers, promotional/earned attribution and separate funding sources. No token launch, token exchange rate, minting, real payment or rewriting saved conversations. Web and Desktop share the same UI and catalogs. Preserve Mycellios Agent as the application name.

Qualify English/Spanish catalog compilation, credit display refresh and unavailable states, integer paid-top-up conversion, unchanged promotional display, contribution controls and scoped incremental types locally. No production promotion in this task.

## Local outcome

Scoped incremental TypeScript and 34 affected tests passed. Frontend compiled with all locale catalogs. Browser fixture passed in English/Spanish at 320, 390 and 1440 px, retaining a 0.954188 balance and separate Promo. Repository structure and UI kit checks passed. Payment conversion is code-tested; no real payment, account mutation or token transaction occurred. Production is unchanged. The previous sidebar artifact with Spores currency labels is superseded and must not be promoted. See `src/agent/outputs/product-terminology-20261031/qualification.json` for source hashes and qualification scope.

## Production outcome

Published build 20261031115929, immutable patch 651ab5019b216f41ed2d0c832c4df68869c57467e19d8456141849bde3f38c7d. Sixty focused tests and eight route-safety tests passed, followed by private Nginx and public HTTPS qualification. Real-account UI labels were checked in Spanish. No database/account/history writes or inference calls occurred. The numeric balance remains unverified because the account lookup is unavailable; the UI shows a dash rather than a fabricated zero. See the canonical status document and release receipts.
