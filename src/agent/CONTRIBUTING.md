# Contributing to Rakazo

Thanks for helping improve Rakazo. Keep changes focused and testable.

## Run locally

Follow the [source checkout setup](README.md#local-development-source-checkout) for prerequisites,
required secrets, and startup commands.

## Fast iteration is the default

Use npm in this repository. From `src/agent`, keep `npm run dev:local:backend`
and `npm run dev:local:web` running for the isolated Windows source preview at
<http://127.0.0.1:5192/app/>. `npm run dev:local:status` checks the web, Vite hot
reload, React Refresh, API and worker concurrently with a three-second timeout.
It only reads loopback endpoints; it never builds, installs, restarts services or
opens a production database. Its result proves readiness, not a rendered interaction.

| Change | Default feedback loop |
| --- | --- |
| CSS, spacing, icons, wording or presentation only | Save, let Vite/React update the running page, review the narrow diff and inspect that surface. No install, full typecheck, build or packaging. |
| Small functional change | Run the directly affected tests and incremental types for the affected app. Reuse compatible installed dependencies. |
| Authentication, permissions, payments, migrations, dependencies or native code | Run the focused boundary checks required by that change; these do not become visual changes because the diff is small. |
| Publication | Integrate current main, pass required checks, build the release artifact once, preserve rollback and verify the served result. Reuse that exact artifact for promotion. |

Windows checks, builds and installs go through the profile's `compilar.ps1` queue;
interactive dev servers and the read-only status command do not. Choose remote
validation when appropriate; a local installation is not a prerequisite to CI.
Do not run the same successful checks twice on an unchanged candidate. Do not
restart an already healthy preview or replace its saved profile for a UI edit.
If a browser tool is unavailable, report the limitation instead of repeating
the same timed-out request. Record omitted checks as omitted.

This follows the development/release separation visible in
[OpenBot's dev service runner](https://github.com/nightly-labs/openbot/blob/main/scripts/dev-services.ts)
(`electron-vite dev --watch`) and
[its build/package scripts](https://github.com/nightly-labs/openbot/blob/main/package.json).
Mycellios keeps its existing npm, React, Vite and permission boundaries; no
OpenBot implementation is vendored. Fast preview is not release qualification.

## Available checks (run only when affected)

| Command | When to run |
| --- | --- |
| `npm test -- <affected test files>` | Units, properties, and in-process contracts for the changed behavior. No live connector or model-provider calls. |
| `npm run test:integration` | Postgres via Testcontainers: product journeys, authorization, executor lifecycle, Graphile / LISTEN/NOTIFY. Needs Docker. |
| `npm run test:e2e` | Playwright against the emulated API. Needs Docker. |
| `npm run test:topology` | Local product-path smoke: Docker computer + Graphile worker recovery. Needs Docker. Not PR CI. |
| `npm run test:canary` | Live provider canaries. Needs keys. Not PR CI. |
| `npm run test:pi` | Real Pi against a local HTTP model fixture: streaming, tool round trips, failures and cancellation. No keys. |
| `npm run test:computer-replay` | Real Pi and Docker Chromium against a local model fixture. Needs the computer image; no keys or Electron windows. |
| `npm run test:evals --list` | List agent-quality cases. Add `--live` and a model connection to measure repeated real-model task success. |
| `npm run test:computer` | Real vision model + E2B desktop. Needs keys; see [computer verification](docs/computer-runtime.md#verification). Not PR CI. |
| `npm run check` | TypeScript (`tsc`) across the monorepo. |
| `npm run lint` | Biome lint and format check. |

CI uses the repository's proportional validation plan in `scripts/ci-proportional.mjs`
against the PR/merge candidate. Full suites remain paused under the current policy;
required security/native checks and real release builds remain in place.

Ordinary test processes (`NODE_ENV=test`) do not load the checkout's `.env`.
Verification CLIs load configuration before starting isolated test processes;
live canaries explicitly enabled with `VERIFY_PROVIDERS` also opt into loading it.

## Adding a UI language

The web and Electron-hosted UI use Lingui catalogs. To add a locale, register it in
`apps/web/lingui.config.ts`, `apps/web/src/lib/ui-locale.ts`, and
`apps/web/src/lib/i18n.ts`, then run `npm run intl:extract --workspace @rakazo/web`, fill the new
`apps/web/src/locales/<locale>/messages.po` catalog, and validate it with
`npm run intl:compile --workspace @rakazo/web`. Keep message IDs, placeholders, JSX markers, and
ICU plural branches intact; do not commit generated `*.js`/`*.mjs` catalog files.

Expo mobile has its own catalog and locale registry. Add the locale to
`apps/mobile/lib/ui-locale.ts`, add `apps/mobile/lib/locales/<locale>.ts`, and register the
catalog in `apps/mobile/lib/i18n.ts`. Web PO entries do not translate mobile automatically.
Update the locale unit tests and a UI E2E scenario for each supported surface. The marketing
homepage in `apps/www` and the native Electron setup window have separate localization paths;
scope and test those changes explicitly instead of assuming the web catalog covers them.

See [agent verification](docs/agent-verification.md) for the distinction between
deterministic execution tests, computer replay, and real-model quality evals.

## Optional live-provider checks

The default Playwright suite uses the fake sandbox. To run the same scripted-agent suite against
real computers, set the matching `E2B_API_KEY`, `DAYTONA_API_KEY`, or `BOAT_API_KEY` and choose a provider:

```bash
pnpm test:e2e -- --sandbox=e2b
pnpm test:e2e -- --sandbox=daytona
pnpm test:e2e -- --sandbox=boat
```

The Playwright workflow also accepts these providers through its manual **Sandbox provider** input.
These runs provision real machines and destroy them after the suite. Automatic runs use `fake`.
For the separate real-model desktop acceptance test, see
[computer verification](docs/computer-runtime.md#verification).

## Secrets and configuration

- **Never** commit `.env` files or secrets.
- **Never** paste API keys, tokens, or passwords in issues or PRs.
- Use placeholders in examples (`your-openrouter-key`, etc.).

The product path is **Pi + Docker + Graphile**. Emulator settings (`AGENT_RUNTIME=scripted`, `SANDBOX_PROVIDER=fake`, `WAKEUP_DRIVER=memory`) are for tests only.

**Integrations** can use [Composio](https://composio.dev/) or Pipedream Connect as optional managed
app catalogs. Users can also install HTTPS MCP servers (including Treg) and bounded OpenAPI tool
sources. Connector tests must stay deterministic and offline. Never put connector credentials in
capability config, fixtures, logs, or snapshots; use the encrypted secret store and fake placeholders.

## Pull requests

- Keep PRs small and easy to review.
- Target the `main` branch.
- Describe why the change is needed, what changed, and **how you tested** (e.g. `npm run test`, manual steps).
- Link related issues when applicable.

## Contact

| Address | Use for |
| --- | --- |
| [security@rakazo.com](mailto:security@rakazo.com) | Vulnerabilities only — see [SECURITY.md](SECURITY.md) |
| [support@rakazo.com](mailto:support@rakazo.com) | User and support questions |
| [elie@rakazo.com](mailto:elie@rakazo.com) | Maintainer |
