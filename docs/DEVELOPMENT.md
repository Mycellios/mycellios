# Development

## Marketing and public Stats

The public `/dashboard` and `/stats` entries render `StatsDashboard` from the
coordinator's public snapshot and persisted history. Explicit console links retain
`/dashboard?view=overview`, `?view=nodes`, and the other existing operational views.
`MarketingHeader` is shared by the landing, Earn, Pricing, Compare and Rewards.
Create and token Data are retired; their old URLs redirect to the landing and Stats.
Treasury/Treasure bookmarks redirect to `/spore/rewards`.

The shared navbar lifts its links and reveals an underline on hover or keyboard
focus. FAQ disclosures share one native name group, so opening a question closes
the previous one. The shared UI kit animates the real answer height, opacity and
chevron, with motion disabled for reduced-motion preferences. The same production
disclosures appear in Storybook's ExclusiveAccordion story.

Stats uses `https://www.mycellios.com/stats` as its canonical URL and sitemap entry.
This route ships with the landing, so publishing does not depend on activating a
new DNS record. The navbar's `/dashboard` link opens the same public Stats UI.
Preview the future subdomain at `http://stats.localhost:4174/`. The exact
`stats.mycellios.com` host selects its own document in the coordinator and client
router; it retains the `/stats` canonical until a verified domain migration.

Production ingress is Cloudflare Tunnel, not Caddy. On 2026-11-02, the existing
`mycellios.com` and `www.mycellios.com` published applications used tunnel
`575f0de0-6771-4ce2-b2f4-11f09da85b2e` on `nc-hz-control-01` with service
`http://10.48.0.6:18080` and default origin settings. The unapplied
`deploy/stats-tunnel-route.example.json` describes an additional published
application for that same service, preserving Host. Recheck these observations
before changing ingress; never replace the tunnel's existing applications.

Activate the alias only after the integrated release serves `stats/index.html`:
verify the origin using `Host: stats.mycellios.com`, then add the published
application and its proxied DNS record in Cloudflare. Verify public DNS, TLS,
the Stats document, its hashed assets and same-origin public snapshot/history
endpoints. Compare `/health` with the intended release and recheck the main site.
Do not point DNS at the old release: its root would display the previous landing.
Moving the canonical to the subdomain requires a subsequent verified migration
of metadata, sitemap and redirects. No DNS or tunnel change is part of a local build.

The GPU calculator has two primary choices: GPU model and daily hours. It shows
daily hours × 30 days × an hourly rate, assuming every selected hour is rented.
The dated default prices are Salad's published Lowest rental tier, with a linked
source and an optional USD rate override in the details. The GPU selector only
lists models with a published reference. These are rental-value references, not Mycellios contributor
remuneration, demand forecasts or net profit. They exclude electricity and fees.
GPU choices do not establish runtime compatibility. Calculators create no charge,
subscription, token conversion or payout. Pricing leads with Coming soon states
for unannounced Mycellios plans, network usage prices and contributor rewards.
The optional provider-cost estimator is inside a closed disclosure and remains
separate from commercial offers. Token, staking and payout marketing uses the
same availability wording; operational account/billing gates are unchanged.
Pricing can load dated
OpenAI and Anthropic standard, uncached text-token rates from
`provider-rate-presets.ts`; the UI links to each official source. These are
editable reference snapshots, not a live quote. Changing currency clears model
rates instead of inventing an exchange rate. Comparisons contain
original copy and primary product sources with a review date.

Globe pins require an announced, mappable city. Unknown regions remain in the
ledger without a fabricated geographic position. No peer arcs are inferred from
the order of workers. The lower landing's decoration uses one shared graph across
contribution, questions and the closing scene; topology tests cover resizing and
expanded answers. Its complete content and animation load before that chapter
enters the viewport, preserving the existing home bundle limit.

## Fedora Desktop RPM

`npm run desktop:package:rpm` creates
`build/desktop-rpm/Mycellios-Desktop-0.3.9-2-fedora-x86_64.rpm`, its SHA-256 and
provenance JSON. Build on Linux x86_64 with `rpm-build`, `binutils`, `tar`,
`gzip` and `zstd`. Install the result with `sudo dnf install ./<artifact>.rpm`.
Build output and cached downloads are ignored by Git.

`config/desktop-fedora-release.json` pins the published Desktop DEB and complete
source archive. The Desktop source supplement identifies its baseline main
revision separately from the bundled runtime version; do not rebuild the older
runtime in main and substitute it for the published payload. RPM revision 1
retains the original application ASAR. Revision 2 backports Linux native window
frames and an explicit packaged window icon through `scripts/adapt-desktop-linux.mjs`.
The adapter rejects unexpected bundle anchors and verifies every other ASAR file,
native-module unpack flag and executable mode. Existing 192px and 512px brand
assets are installed in indexed hicolor directories; the original 1024px directory
is not indexed by Fedora's theme. The runtime archive, licenses and account logic
remain byte-identical. Provenance records both ASAR hashes and the changed entry;
the adapter source is included under `/usr/share/doc/mycellios-desktop`.
Revision 2 uses a separate RPM filename and never overwrites the preview asset.

`deploy/linux/install-desktop-runtime.sh` verifies the bundled payload's hash
and package identity, then extracts its `/opt/mycellios` tree as data without
dpkg. The native node installer still owns service registration and enrollment.
Installing or removing Desktop never starts, enrolls, removes or replaces a
contribution node. An existing identity or incomplete installation is preserved.
Contribution setup requires the normal signed-in account action and polkit.
Fedora uses Chromium's user-namespace sandbox; the package does not disable it.

Run `npx vitest run tests/desktop-rpm.test.ts tests/desktop-runtime-fedora.test.ts tests/desktop-linux-window.test.ts`.
RPM tests use the real RPM tools; enrollment-helper tests use Bubblewrap user
namespaces with temporary `/etc` and `/opt`, synthetic payloads and no network.
Missing platform tools or unavailable user namespaces produce explicit skips.
Interactive sign-in and real network enrollment require separate user testing.

The separate `/downloads/desktop` page is built from
`landing/src/DesktopDownloads.tsx` with `node scripts/build-desktop-downloads.mjs`
into `build/desktop-downloads/web`. Preserve the EXE/DEB catalog and existing
immutable files when publishing this static surface. The Fedora row uses the
qualified GitHub preview asset pinned in `landing/src/desktop-fedora-download.ts`;
its version, size and SHA-256 must match the published release. Do not append
RPMs to the legacy two-package catalog: older page versions reject unknown entries.
Run `npx vitest run landing/src/desktop-downloads.test.tsx` and
`npm run landing:typecheck` when changing this page.

## Shared interface kit and Storybook

The default homepage leads with an Agent product hero. Its latest art direction
follows the supplied light paper composition: a large title, compact app window,
computing islands linked by mycelium and a three-item benefit strip. The earlier
`https://x.ai/bot` reference informed the product-demo structure. `AgentProductHero` owns the opening;
`AgentHeroDemo` recreates the published Agent's paper/stone workspace, Mico
avatars, conversation, permissions, composer and previews. Its examples are
synthetic: no account, model, file or tool API is called. The actual app remains
at `/agent`, and the download actions use `/downloads/desktop`.

A separate GSAP module animates the entrance, message typing, permission example
and result. Visitors can switch Micos, search the example roster, open a local
preview, pause and replay. Offscreen playback pauses; reduced motion shows the
completed example immediately. Lifecycle cleanup removes owned timelines and
observers. The production UI kit owns the scoped marketing and demo controls. The decorative
living network uses a transparent, reference-guided image_gen asset with native
CSS breathing and spores. GSAP drives light impulses along six paths registered
to the artwork; path geometry is sampled once, then interpolated per frame. The
image and signals share a breathing layer so they stay aligned. Background layers
do not react to mouse movement or clicks; artwork and spores have no pointer
parallax. The scene runs
independently after the app sequence, shares the Pause animations control and
removes its ticker subscription while paused, offscreen or hidden. Reduced motion
keeps a static illustration. Cleanup removes owned observers, listeners and
transforms. Asset, prompt and provenance live in
`landing/public/assets/agent-demo/living-network-v1.json`.

The product story continues with three selectable synthetic workflows: planning,
research and writing. Each shows a request, attached context, a permission and a
draft. `AgentUseCasesEntry` defers that chunk near the viewport and retains a
usable Agent link if loading fails. The shared controls support keyboard selection;
the draft updates without moving focus. A sampled SVG filament carries a
GSAP-smoothed scroll impulse from the hero environment through these examples to
the network chapter. It does not pin or move the original network illustration.
The hero Mico greets pointer, keyboard and click input. These effects share global Pause/Play, respect
reduced motion and clean up their timelines, listeners and observers. The example
drafts and decorative traffic are authored illustrations, never live execution.

The homepage closes after the FAQ with "Grow your first Mico": the existing Mico,
converging mycelium and one Agent entry action on the same continuous paper canvas.
Upper filaments reach into the space below the FAQ. Its text, avatar and link are
available independently of the decorative chunk. The SVG/GSAP scene loads near the
viewport; when the emblem is visible, paths light progressively and the Mico wakes.
The network remains lit with traveling signals while the section is visible and
re-arms after a complete exit. A local Pause/Play control complements global pause.
Its owned ticker stops offscreen, hidden or paused. Reduced motion keeps a complete
static scene; cleanup reverts styles and removes observers/listeners. The legacy
forest opening keeps its original ending.

The lower contribution, FAQ, closing and footer share one rooted backdrop. Its
decorative chunk starts loading near the contribution section. Layout-aware roots
stay in the outer gutters, widen beside the FAQ and cross only the whitespace
between sections; their ends join the closing's filaments. A ResizeObserver
updates geometry when the viewport or open answers change. Traveling signals share
the page-wide and local mycelium pause controls, stop offscreen/hidden, and become
static for reduced motion. The closing artwork and its control are portalled into
the closing section while the background covers the whole lower group.

The unchanged 350 KB homepage JS budget counts both the motion entry and its
shared GSAP dependency. Avatar provenance lives in
`landing/public/assets/agent-demo/provenance.json`.

The previous forest concept is preserved at `/?intro=forest` and the paused
`/forest-loader-preview.html` (`npm run landing:dev`), with its original network
opening. It is no longer a gate before the new homepage. Only the current
orientation's versioned pair is requested (841,196 bytes for landscape or
673,570 for portrait). Its image_gen prompts and derivatives remain recorded in
`landing/public/assets/loading/provenance.json`. Route readiness, Skip intro,
Escape, reduced motion and chunk/image failure fallbacks remain supported.

Verify with the focused forest lifecycle, living-network model/clock and landing SEO tests,
`npm run landing:typecheck`, `npm run verify:ui-kit`, `npm run storybook:build`
and `npm run landing:build`.

The landing lives in `landing/src/rebrand/ReferenceLanding.tsx`. Its network
chapter retains the shared Agent controls and authored computing-fabric WebP. `NetworkPrint` applies an event-driven WebGL print effect;
the image stays available when WebGL is unavailable and for reduced motion.
The artwork remains centered in normal document flow as the page scrolls; the
network chapter follows underneath without sticky overlap, panning or scaling.
The mushroom illustration is the default, without comparison controls, including
on previously shared `/?compare=mushrooms&art=fruiting` links. `/?art=fabric`
restores the exact original asset. The renderer and layout are shared; Storybook
keeps the original illustration in `Screens/Landing/OriginalArtwork`.
The header exposes Agent, Create and Earn, with Live network, Docs and the Token
links (Staking, Treasure and Data) grouped in a single Explore disclosure.
Login remains available on desktop and in the responsive menu; social links
live in the footer.
A primary Download action opens `/downloads/desktop` and remains visible beside
the mobile menu toggle. The header respects display cutouts and the mobile menu
uses the small viewport height. Docs remains linked from the page and footer. The Token group
uses the existing SPORE routes and shared disclosure primitive; other surfaces retain
their original labels. `Screens/Landing/Navigation` renders the production header.
Its scene is conceptual. The expanded Agent example includes local attachment
fixtures, not real user files or completed actions. Production and the
`Screens/Landing` Storybook story import the same components. Real conversations
open the published Agent app. Reference-specific layout uses `mycellios-reference`
over the existing marketing base and does not repaint the panel or studios.

The hero has one action, How it works, which scrolls to `#network`. That chapter
contains the API endpoint; computer/browser contribution choices appear only
under `#contribute`. Desktop download links share `/downloads/desktop`. The
Agent illustration has one outbound handoff in its composer; its other controls
stay within the example instead of opening the app under unrelated labels.

Previous versions remain available: `/?landing=assemblage` shows the discarded
composition, `/?landing=rooted` restores RootedLanding,
`/?landing=saved` shows ModernLanding, and `/?landing=previous` shows the earlier
complete landing, with optional `&hero=dark`. Their TSX and CSS are preserved.
Only the last variant preloads the large WebGL mushroom chunk.

Reusable web UI lives in `landing/src/ui`. Production pages and Storybook import
the same modules. The dashboard, landing, account, studios and browser worker
use its Button, Link, Input, Select, Textarea, labels, forms, headings, cards,
dialogs and table elements. Repeated page titles, metrics, disclosure panels,
selectors, sidebar and pagination also live there.
Spacious marketing actions use the kit's `xl` size (52px, or a scoped
`--ui-control-xl-height`); the existing compact app sizes are unchanged.

```bash
npm run storybook
npm run verify:ui-kit
npm run storybook:build
```

The catalog opens at `http://127.0.0.1:6006`. Configuration is under
`landing/.storybook`; build output is ignored under `storybook-static`.
The theme toolbar selects the production light or dark theme. Stories cover
button variants and sizes, native form semantics, loading, disabled and error
states, tables, disclosures, dialogs and sidebar alignment in both widths.
The default Agent design uses `landing/src/ui/agent-style.css`, matching the
Mycellios Agent fork's Geist Variable and compact controls. The light palette uses
Agent's paper `#f8f5f0`, pale stone cards `#f1eee8`, a warmer sidebar `#eee9e2`,
and low-saturation deep moss actions. Dark mode keeps its neutral gray palette.
Ordinary icons have no decorative plates. Text fields use a warm muted fill at
36px, search wrappers a single 40px frame, and selectors a pale paper fill at 32px.
Segmented controls use a stone track with a raised paper selection; hover and
selected states have separate tokens. Shared token changes also apply in Storybook.
`agent-components.css` maps production surfaces, tables, fields, menus, icons
and interaction states to those semantic tokens. Its scoped compatibility reset
removes legacy per-page paint; add component roles there instead of adding color
overrides to individual pages. Status text uses the card surface to retain
readable contrast in both themes.
Agent uses 12px card corners, 1px edges, 16px insets and 20px between panel
sections (14px/16px on mobile). Motion follows the reference: 100ms popup entry,
150ms controls/disclosures and 220ms page entry. Native disclosures interpolate
their content height where supported; other browsers keep native toggling.
Reduced motion disables these effects. Pointer focus has no extra frame;
keyboard focus keeps a rounded, thin indicator. Inputs keep their border focus
without an exterior ring.
The font is served locally under `assets/fonts` with its SIL Open Font License.
The previous design remains intact: `?design=classic` selects it and
`?design=agent` returns to Agent. An explicit selection persists across navigation.
Storybook exposes the same profiles through its Design toolbar. The classic dark
palette remains in `landing/src/ui/dark-theme.css` with its separate light scope.
All themes and decorative artwork use flat fills. `verify:ui-kit` rejects CSS,
SVG and canvas gradient definitions in production web sources.
Stories use the production viewport wrapper. Full shells such as Sidebar set
`parameters.ownsThemeRoot` and consume the toolbar theme themselves, avoiding
nested light/dark roots that override each other's backgrounds and text.
Operation stories render the real node, model, task, log, benchmark, API and
billing panels with local fixtures. Benchmarks and billing accept optional read
loaders so their stories do not query private services or require credentials.
The history story renders the production report with local samples so chart
lines, legends and tables can be checked without waiting for live telemetry.

Add new reusable controls to the kit and add stories importing those exports.
Do not implement controls inside stories or add native controls directly to
pages. `verify:ui-kit` rejects native control, typography and table bypasses;
CI also builds Storybook. Keep page-specific layout classes while centralizing
control geometry in `landing/src/ui/ui.css`. Keyboard focus and native browser
validation remain part of the component contract.

## Prerequisites

- Node.js 24 or newer
- npm 10 (the exact version is pinned in `package.json`)
- Python 3.12 and the runtime dependencies needed by the selected executor

## Install and verify

```bash
npm run doctor
npm ci
npm run check
npm run build
```

If another npm major is installed, `npx --yes npm@10.9.8 run doctor` runs the
pinned tool without changing the global installation. Use the same prefix for
the other npm commands.

Use focused commands while iterating:

```bash
npm test -- --run tests/<area>.test.ts
python -u scripts/run-python-tests.py
npm run verify:architecture
npm run verify:component-boundaries
npm run verify:bundle
```

`npm run doctor -- --json` provides machine-readable diagnostics for setup
scripts and support requests. Python 3.12 is required for full runtime work; a
missing Python interpreter is reported as a partial control-plane setup rather
than a successful full-runtime setup. Discovery checks `MYCELLIOS_PYTHON`, the
prepared runtime (including Windows `Scripts/python.exe`), and system/managed
interpreters. An incompatible Python earlier on PATH does not hide a prepared
Python 3.12 runtime.

Physical tests are opt-in and must not be presented as passed when skipped:

```bash
npm run test:physical-launcher
npm run test:physical-external-cell
npm run test:physical-recovery
npm run test:physical-gpu-cell
```

The Python runner fails on every failure or import error, including without
`--strict`; that flag remains accepted for existing callers. Skips are reported
separately. The small FP32 CPU cell fixtures compare each coordinate against its
token's activation scale with a fixed `32 * float32.eps` budget. Independent
FP64 reference measurements showed reduction-order roundoff in both dense and
sharded paths. This fixture budget is not a GPU accuracy claim; exact cache,
fork, promotion and alias checks remain in place, with separate corruption
rejection tests for the numerical helper.

The two cache/fork regression fixtures use fan-in-scaled projection matrices.
Unit-variance random matrices amplified rounding across repeated decode steps
enough to exceed the budget on a hosted CI CPU. Scaling the fixture inputs keeps
the same seeds, dimensions, state transitions and fixed acceptance budget; it
does not change runtime arithmetic or certify arbitrary ill-conditioned weights.

On Windows, point tools at the prepared runtime when Python is not installed
system-wide:

```powershell
$env:MYCELLIOS_PYTHON = (Resolve-Path runtime/distribution-venv/python.exe).Path
npm test -- --maxWorkers=1
& $env:MYCELLIOS_PYTHON -u scripts/run-python-tests.py --strict
npm run dev:e2e:distributed -- --runtime runtime/distribution-venv --timeout 120
```

The development gate needs its selected model in the Hugging Face cache. A
local validation used `hmellor/tiny-random-LlamaForCausalLM` at revision
`9408c553e5c189a7dcdc5a5dbd2feb476b061759`. Prepare the snapshot in the gate's
cache before an offline run. Random tiny-model output validates routing and
cleanup, not answer quality or physical multi-host performance.

Set `MYCELLIOS_DEV_E2E_HF_HOME` to an explicitly prepared Hugging Face cache when
validating an isolated checkout. Relative paths resolve from that checkout.
Copied snapshot symlinks must still resolve to blobs inside the same model
repository, or be materialized as regular files. Cross-repository links are
rejected by the checkpoint containment guard. `MYCELLIOS_DEV_E2E_DEBUG=1` enables
coordinator diagnostics for investigating preparation and worker disconnects.
Keep native runs, builds and the full test suite sequential on memory-constrained
machines; the example's `--maxWorkers=1` limits test concurrency.

## Development rules

- Preserve fail-closed schemas and identity checks.
- Do not replace measured values with projections or simulator output.
- Keep secrets in environment variables; examples contain environment-variable
  names, never credentials.
- Add a spec only for active medium/large work. Remove it after its durable
  decisions have been incorporated into canonical docs.
- Update `STATUS_AND_EVIDENCE.md` only when an implementation or immutable
  evidence artifact changes the stated boundary.
- Do not commit generated runtime state, model caches or local credentials.
- Follow the ownership and dependency rules in
  [`REPOSITORY_STRUCTURE.md`](REPOSITORY_STRUCTURE.md).
- Reduce a module's recorded ceiling in `config/module-size-budget.json` after
  extracting code; never raise a ceiling to make the architecture gate pass.

## Useful entry points

### Control plane

```bash
npm run dev:coordinator
npm run dev:worker
npm run dev:launch-agent -- --node-id node-a
```

### Two-host preparation and evidence

```bash
npm run preflight:two-host -- --config <file> --json
npm run model:auto-distribute -- --config <file> --prepare-only
npm run diagnostics:remote -- --help
```

The preflight is portable and non-mutating. The current setup, stage and GPU
campaign scripts ending in `.ps1` are Windows entry points. On Linux and macOS,
use the portable preflight and Python runtime commands; Windows-only operations
are unavailable rather than silently simulated.

### Quality and architecture

```bash
npm run verify:structure
npm run verify:docs
npm run verify:format
npm run verify:architecture
npm run verify:component-boundaries
npm run verify:bundle
```

### Safe tasks without a GPU

- Add a negative fixture for a fail-closed schema or CLI parser.
- Improve a stable diagnostic while preserving its error code.
- Reduce one tracked module below its recorded ceiling with characterization.
- Fix a canonical documentation link or command verified by the docs gate.
- Add a platform capability check to the dependency-free developer doctor.

These are candidate task shapes, not a promise that a GitHub label exists.
Check the live issue labels before referring contributors to `good first issue`.

The HTTP contract is in [`openapi.yaml`](openapi.yaml). Architecture changes
must also update [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Optional Kokoro speech replicas and AntSeed

Kokoro is a native full-model replica workload, not a Transformers pipeline.
The initial model ID is 'mycellios-kokoro-es', with the Spanish voice 'ef_dora'.
Each designated node runs the local runtime and its configured Mycellios worker.
The normal coordinator authenticates the worker, schedules replica leases and
returns its result through '/v1/chat/completions'. Existing workers require an
updated release before they can advertise the new adapter; do not claim the
feature is installed on the fleet merely because a coordinator test passes.

### CPU runtime on a Linux node

Build the optional image from the repository root:

~~~bash
docker build -f deploy/kokoro.Dockerfile -t mycellios-kokoro:local .
mkdir -p runtime/kokoro-cache
# The image runs as UID 10001; grant that UID write access to this cache only.
docker run --name mycellios-kokoro --network host \
  --cpus 2 --memory 3g --memory-swap 3g --pids-limit 128 \
  --cap-drop ALL --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,exec,nosuid,size=128m \
  -v "$PWD/runtime/kokoro-cache:/cache" mycellios-kokoro:local
~~~

The HTTP listener is hard-coded to IPv4 loopback; host networking does not
publish it to the LAN. The temporary mount needs executable mappings because
phonemizer loads a temporary copy of the eSpeak shared library. Keep the
non-root user, read-only image and dropped capabilities. The first launch
downloads the pinned Kokoro revision, the selected Spanish voice and the
cl100k_base tokenizer. Inference makes no cloud inference calls. For offline
operation prepare that cache first, then disable the runtime's network egress.

The worker uses 'config/worker.kokoro.example.json'. Set
GPU_MESH_WORKER_CONFIG to a private copy and GPU_MESH_COORDINATOR to the
authorized coordinator. Preserve the existing worker's credential; use a
separate MYCELLIOS_WORKER_CREDENTIAL_PATH if starting another speech worker.
Enroll it through the existing signed admission/ownership flow. Do not bypass
that flow or overwrite an existing node configuration. Start with
'npm run dev:worker' in development or the verified packaged worker in a release.
CPU RAM is capacity, not GPU VRAM. Do not independently promise the same memory
to multiple workers on one PC.

Kokoro's fixed model revision and weight SHA256 are checked before the replica
is advertised. Runtime model loading and CPU configuration are explicit; this
version does not automatically install Kokoro on every connected PC.

### Chat request and audio response

Send one user message with the exact text to synthesize:

~~~json
{
  "model": "mycellios-kokoro-es",
  "messages": [{"role": "user", "content": "Hola. Esta voz se genera en Mycellios."}],
  "max_tokens": 1,
  "stream": false
}
~~~

The result remains a normal chat completion. Parse choices[0].message.content
as JSON. It is a mycellios-speech/1 envelope with text, voice, and audio:
format=wav, sample_rate=24000, duration_seconds, sha256, and base64 data.
Verify the hash before playback. scripts/read-kokoro-audio.mjs validates and
extracts a saved response into a new WAV file.

Input is limited to 400 Unicode characters and output to 1 MiB of mono PCM16
WAV, approximately 21.8 seconds. Oversized audio fails rather than truncating.
The voice can be set at runtime startup with MYCELLIOS_SPEECH_VOICE to
ef_dora, em_alex, or em_santa; per-request voice changes are not supported.
stream=true streams the completed envelope in bounded JSON fragments, not
real-time audio synthesis. Assemble all fragments before decoding or playing.
Cancellation aborts the HTTP delivery; an already-running local synthesis
finishes under the same single-slot runtime lock before accepting another job.

Usage counts only the synthesized text with the real cl100k_base tokenizer.
completion_tokens is zero: base64 and WAV bytes are not generated text tokens.
System/developer instructions are ignored and not billed; conversation history
and multiple user messages are rejected. max_tokens does not truncate audio.
The independent speech byte/duration checks remain enforced at both boundaries.

### AntSeed provider

Merge config/antseed.kokoro.example.json into the seller's configuration,
point baseUrl at the authorized Mycellios coordinator, and provide a dedicated
Mycellios API key via MYCELLIOS_ANTSEED_API_KEY. Do not put credentials in JSON.
Use the built-in openai plugin. Keep the same openai-chat-completions protocol
on both sides; conversion to another protocol may discard the audio envelope.
Capabilities announce text input and text/audio output.

The example is deliberately priced at zero for functional validation. Set an
explicit input-token price only when commercial operation and a paid test are
authorized. Never report characters, audio bytes or seconds as invented tokens.
This configuration does not enable /v1/audio/speech on AntSeed. Buyers call
/v1/chat/completions and decode the speech envelope themselves.

### Verification

~~~bash
npm test -- --maxWorkers=1 tests/kokoro.test.ts tests/kokoro-network.test.ts
MYCELLIOS_KOKORO_REAL_URL=http://127.0.0.1:8890/ npm test -- --maxWorkers=1 tests/kokoro-network.test.ts
PYTHONPATH=python python -m unittest python.tests.test_kokoro_engine
~~~

The ordinary network fixture has two logical replicas on one host and is not
physical two-host evidence. The real runtime case is opt-in and skipped unless
configured. Tests cover checkpoint identity, corrupted audio, cancellation,
bounded delivery, replica routing, SSE completion and token accounting.

For an isolated AntSeed P2P smoke, install @antseed/node@0.2.147 and
@antseed/provider-openai@0.2.52 in runtime/antseed-proof, then run:

~~~bash
node --import tsx scripts/smoke-kokoro-antseed.ts
~~~

This uses fresh test identities, private bootstrap only, secure P2P, zero
prices and disabled payments. It writes a WAV and verification receipt under
runtime/kokoro-proof-*. It does not announce a public seller or demonstrate
USDC settlement, ANTS eligibility, public gateway access or the physical fleet.

Standalone speech replicas need their own stable instanceId and device key. On a
public coordinator, signed registration alone does not establish account ownership.
Create and confirm a fresh enrollment from the owning account, then deliver its
one-shot bundle to the replica over the authorized management connection. Set
MYCELLIOS_WORKER_ENROLLMENT_PATH to that protected JSON file before starting the
worker. The existing bootstrap redeems it with the replica's actual public key
before admission and deletes it after successful redemption. Never reuse a consumed
bundle, copy another node's protected key, weaken WebSocket ownership checks, or
give a replica the coordinator's network administrator token.

The optional Windows supervisor is deploy/kokoro-start.ps1. Install it next to
worker.json, the verified app/ worker payload and the optional venv/ dependencies
under C:/ProgramData/Mycellios/Kokoro. Run it as LocalService using the existing
service wrapper; grant read/execute on code and modify only on Cache/, Logs/ and
State/. It uses the installed Mycellios CPU interpreter, adds the isolated optional
dependencies through PYTHONPATH, binds speech to loopback and waits for the pinned
runtime identity before starting the worker. Keep HF_HUB_DISABLE_XET=1 in the
service environment for the standard verified HTTPS model download path. The
supervisor uses two Torch threads and a process memory watchdog; this is not an
OS-enforced memory quota. Stopping the service must remove its owned child processes.

Operator-funded service quota is opt-in through
`MYCELLIOS_API_OPERATOR_QUOTA_MODELS_JSON`, a JSON object mapping dedicated API
key IDs to model ID arrays. Use only for explicitly operator-funded routes.
It preserves real usage counters and request/concurrency limits, while removing
starter-token debits for that exact key/model pair. A persisted reservation marker
keeps completion accounting stable across restarts and policy changes. Default is
empty. Never put API key secrets in this setting or expose administrative tokens.

## Optional decision service through AntSeed

`jev` accepts the typed decision envelope described in
[status and evidence](STATUS_AND_EVIDENCE.md#experimental-kev-decision-graphs).
It is not a prose-completion model. Keep one user message containing the JSON
envelope as a string, and use `max_tokens: 1`; actual output token usage is zero.

For a pinned seller behind the AntSeed gateway, set both the model and provider:

```http
POST /v1/chat/completions
Authorization: Bearer <gateway-api-key>
Content-Type: application/json
X-Antseed-Provider: mycellios-decisions

{
  "model": "<seller-peer-id>@jev",
  "messages": [{
    "role": "user",
    "content": "{\"schema\":\"mycellios-decisions/1\",\"state\":\"My card was charged twice.\",\"questions\":{\"department\":{\"type\":\"choice\",\"instructions\":\"Choose the responsible team.\",\"criteria\":{\"billing\":\"Charges and refunds\",\"technical\":\"Software errors\"}}}}"
  }],
  "max_tokens": 1,
  "stream": true
}
```

Through OmniRoute, prefix the model with `antseed/`, retaining that provider
header and the same envelope. Use the corresponding OmniRoute API key. Do not
add diagnostic fields to the strict Mycellios request body; use headers for
correlation instead.

Use SSE (`stream: true`) for long decisions. The distributed pilot can exceed
AntSeed's five-minute initial-response timeout; the existing streaming route sends
admission/heartbeat events while the atomic decision is computed. Require the
final decision, usage, successful finish and `[DONE]`, not just HTTP 200 or an
early stream event. Native execution retains its absolute nine-minute lease.

The provider selector matters on a seller advertising several providers: the
gateway's implicit selection may use the first provider's pricing telemetry.
Confirm the signed `jev` offer has zero prices and a successful gateway receipt
records `served_free=1`, actual input usage and zero output usage. A configured
zero price or a schema-rejected request alone does not close the buyer gate.
