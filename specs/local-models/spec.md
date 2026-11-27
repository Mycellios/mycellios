# Local models on the user's PC

Status: phase 1 implemented (see "Phase 1 as built"); phases 2 and 3 proposed.

## Goal

A person who only has Mycellios Desktop can press one button and have a Mico
answer with a model that runs on their own computer: no paid provider, no
Credits, nothing leaving the machine. People who want to choose can browse an
automatically built catalog that says how well each model runs on their PC.

Local models complement the free cloud models; they never replace them silently.

**Speed first.** The local option exists for people whose PC cannot use paid
models or the distributed Mycellios network at a given moment. If it is slow,
they close the app. The default local model is therefore the fastest model that
still passes the tool-call check, even if a larger one would answer better.
Larger models are an explicit opt-in ("Smarter, slower"). If not even the
smallest model meets the speed floor on a PC, the local option is not offered
there by default and the free cloud models stay the default.

Speed floor for the default model, measured on the user's PC:

- warm first token (new message after warm-up) ≤ 1 s;
- generation ≥ 20 tokens per second;
- model load plus prefix warm-up ≤ 15 s, done in the background before the
  person needs it;
- download ≤ ~2 GB, so the one click finishes in minutes.

## Non-goals

- No hand-maintained list of tested models. The catalog is generated; only a
  publisher allowlist, a set of supported tool-call formats and one optional
  override for the default recommendation are maintained by hand.
- No local models in the browser, the mobile apps or the server fallback. They
  run only where Desktop runs the Mico's turns.
- Not part of contribution (earning Credits). Serving the network with a model
  stays in the native node runtime and its own qualification.
- No bundled Ollama. An existing Ollama or LM Studio remains usable as an
  optional external provider (current `local-model-discovery`).

## Decisions and evidence

### Engine: pinned llama.cpp `llama-server`

Desktop ships and manages a pinned `llama-server` from llama.cpp, not a private
Ollama copy.

- Size on Windows: the Vulkan build is ~37 MB and the CPU build ~24 MB, against
  ~1.6–1.9 GB for an Ollama install. The CUDA build (~630 MB with runtime DLLs)
  is downloaded only when an NVIDIA GPU is present.
- Integrated GPUs: Ollama skips integrated GPUs unless an opt-in variable is set
  and was still fixing integrated-GPU allocation bugs in late 2026; llama.cpp
  Vulkan uses them directly.
- No conflict with a user's own Ollama (port 11434, its model store, its
  auto-updater).
- Chat templates and tool calls come from the model's own Jinja template
  (`--jinja`), with native parsers for the common formats.
- Explicit control of context size, KV cache type, idle unload and prompt
  caching (`--cache-ram`, slot save/restore).
- The repository already pins and hash-verifies llama.cpp b12613
  (`python/distributed_runtime/llama_cpp_runtime.py`) and Desktop already has a
  verified download store (`packages/adapters/src/native-engine-store.ts`).
- Other desktop apps converged on the same choice (llama.cpp directly or through
  a thin manager).

Builds per platform:

| Platform | Shipped with the installer | Downloaded on demand |
|---|---|---|
| Windows x64 | Vulkan + CPU | CUDA when an NVIDIA GPU is detected |
| Linux x64 | Vulkan + CPU | CUDA when an NVIDIA GPU is detected |
| macOS arm64 | Metal | — |
| macOS x64 | CPU | — |

On-demand builds use the native-engine store: pinned URL, size and SHA-256,
atomic install, previous copy kept until the new one starts. MLX on Apple
Silicon and ROCm are possible later additions, only after measurement.

### Light mode is required

Prompt reading (prefill) on ordinary PCs is the bottleneck. Pi's current prompt
is ~20–27k tokens; a cold first turn of that size takes minutes on an integrated
GPU. Local models therefore always run Pi in light mode:

- system prompt plus tool schemas within 3–5k tokens (at most ~8k for large MoE
  models on capable hardware);
- 6–10 core tools with terse schemas, plus one `load_tools` tool that adds other
  tool groups on request;
- byte-stable prefix: fixed system prompt and tool order, variable content
  (dates, memory snippets) at the end;
- prefix warm-up: when a model is loaded, Desktop prefills the fixed prefix and
  saves the slot, so a new conversation pays only for its own messages;
- thinking disabled or capped for models that support it;
- conversation compaction at ~60% of the context window.

### Measured on the reference laptop

Ryzen AI 9 HX 370 with Radeon 890M (16 GB shared), 32 GB RAM, Windows 11,
balanced power plan, on AC power, llama.cpp b12613 Vulkan, all layers on the
GPU, flash attention on, 32k context. Agent-shaped turn: system prompt of the
given size, 8 tools, a question that requires `read_file`, then the tool result.

| Model (file) | Prompt | 1st turn: first token | Prefill | Generation | 2nd turn (cached prefix) | Tool call |
|---|---|---|---|---|---|---|
| Qwen3-4B Q4_K_M (2.3 GB) | ~4.3k | 32 s | 139 t/s | 8.7 t/s | 0.9 s | correct |
| Qwen3-4B Q4_K_M | ~24k | 240 s | 84 t/s | 7.0 t/s | 1.7 s | correct |
| Qwen3.5-9B Q4_K_M (5.7 GB) | ~4.5k | 53 s | 87 t/s | 6.5 t/s | 1.0 s | correct |
| gpt-oss-20b MXFP4 (12.1 GB, MoE) | ~3.9k | 26 s | 152 t/s | 10.2 t/s | 1.9 s | correct |
| gpt-oss-20b MXFP4 | ~11k | 46 s | 165 t/s | 8.8 t/s | 2.3 s | correct |

`llama-bench`, Qwen3-4B Q4_K_M: Vulkan pp512 172 t/s / tg32 12 t/s; CPU only
pp512 132 t/s / tg32 8.4 t/s.

Small models, light prompt (~3k tokens, 16k context), same turn plus a new
conversation on the warm prefix with a question that needs no tool:

| Model (file) | Cold first token | Warm first token (new chat) | Generation | Tool call | No-tool question |
|---|---|---|---|---|---|
| Qwen3.5-0.8B Q4_K_M (0.5 GB) | 3.3 s | 0.1 s | 49–58 t/s | correct | correct, weaker wording |
| LFM2.5-1.2B Q4_K_M (0.7 GB) | 4.7 s | 0.7 s | 55–62 t/s | **refused, then called late** | odd preamble |
| **Qwen3.5-2B Q4_K_M (1.3 GB)** | 7.1 s | **0.2 s** | **22–28 t/s** | correct | correct |
| Gemma 4 E2B Q4_K_M (3.1 GB) | 7.9 s | 0.2 s | 21–30 t/s | correct | correct |
| Qwen3.5-4B Q4_K_M (2.7 GB) | 22.7 s | 0.5 s | 8–13 t/s | correct | correct |

On this machine only the 2B class meets the speed floor with correct tool use;
Qwen3.5-2B does it with the smallest download. The 0.8B model is the fallback
for weaker machines. 4B and larger models are opt-in here.

Conclusions:

- A cold 24k prompt (today's Pi) takes four minutes; light mode is mandatory.
- Prefix caching works, including for the hybrid Qwen3.5 model in this test: a
  follow-up turn starts in 1–2 s. With warm-up, the first message of a
  conversation behaves like the follow-up turn.
- Among larger models, the MoE gpt-oss-20b (3.6B active parameters) is both
  faster and stronger than the dense 9B, so MoE models are the preferred
  "Smarter, slower" option when they fit in memory.
- 6–10 tokens per second (4B and larger here) feels slow; they are never the
  default on this class of machine.
- The measurements are below published figures for the same chip (which used a
  performance power profile). The fit estimate must be calibrated with the
  user's own measured speeds, not only with bandwidth formulas.

## User experience

The approved mockup has four places. The wording below is the source for the
English catalog; Spanish follows the usual Lingui process.

1. **Model picker, "On your PC" section.** A "Use a model on your PC" entry and
   the installed local models with a speed pill. Shown only in Desktop, or in the
   web app when the Mico runs on a PC whose Desktop reports the capability.
2. **One-click dialog.** A short summary of the PC, the recommended model with
   download size, expected first-reply time and speed, and one primary action
   "Install and use". Then a progress bar (download, verification, first load,
   warm-up) and "Ready". The Mico switches to the model only after the tool-call
   check below passes.
3. **"Browse models".** Search; chips: Recommended, Fast on your PC, Code,
   Reasoning, Sees images, All. Each card: name, publisher, fit pill
   ("Runs fast", "Runs, slower", "Very slow", "Doesn't fit"), size. Details
   expand to the version selector (Light / Balanced / Quality, mapped to
   quantizations), context, tool support, license and source link.
4. **Settings → Models → On your PC.** Disk used, per-model "Free memory"
   (unload) and "Delete", the speed measured on this PC, and the optional
   "Use my Ollama / LM Studio" connection.

Rules:

- The one-click button installs the fast default model. The dialog shows one
  secondary link, "Smarter, slower", that offers the largest model that still
  runs acceptably, with its measured or estimated speed in plain words.
- If no model meets the speed floor on the PC, the entry reads "Your PC is too
  slow for local models" with the free cloud models as the action, instead of
  an install button.
- After a model is used, the speed pill and the dialog show the speed measured
  on this PC instead of the estimate.
- Turns served by a local model show no Credits and a small "On your PC" mark.
- If the PC is offline, the Mico's turns follow the existing offline rules; the
  server never runs a local model on the user's behalf, and switches only to a
  cloud model the user already allowed.

## Hardware tiers and recommendation

Desktop measures GPU type and memory, RAM, free disk, power source and, after
first use, real prefill/generation speed.

The default is chosen by speed, not by size: the largest model that meets the
speed floor and passes the tool-call check. Expected outcome per tier (to be
confirmed by measurement on each tier):

| Tier | Typical machines | Fast default | "Smarter, slower" |
|---|---|---|---|
| Strong GPU | NVIDIA ≥ 8 GB VRAM; Apple Silicon M2 Pro/M3 Pro or newer | 4–9B Q4 (meets the floor there) | MoE 20–35B (gpt-oss-20b, 35B-A3B class) when it fits |
| Integrated GPU / base Apple Silicon | 890M class, M1–M4 base, 16–32 GB | 2B class (Qwen3.5-2B, measured above) | gpt-oss-20b with ≥ 32 GB RAM; 4B otherwise |
| Weak | CPU only, < 16 GB RAM | 0.8B class, only if it meets the floor | none |
| Below the floor | — | local not offered by default | — |

The recommendation is computed from the catalog and the PC's measured speed;
one reviewed override for the default pick per tier is allowed because that
single choice matters most. A model is re-measured after installation; if it
misses the floor in real use, Mycellios proposes the next faster model.

## Catalog

Built by the Agent API server once a day and published to Desktop as a signed,
versioned `local-model-catalog.json`. Desktop never queries Hugging Face to list
models; it only downloads files listed in the signed catalog.

Source: Hugging Face Hub API (`library=gguf`, `pipeline_tag=text-generation`,
`expand[]=gguf,downloads,tags`, sorted by downloads and trending score; per-file
sizes and LFS SHA-256 from the repository tree).

Filters:

- Publisher allowlist: official model organizations (Qwen, google, mistralai,
  microsoft, ibm-granite, openai, meta-llama, ggml-org) and established
  quantizers (unsloth, bartowski, lmstudio-community).
- License allowlist (apache-2.0, mit and named open-weight licenses reviewed
  once); unknown or "other" licenses are excluded.
- Instruct/chat models only; names or tags marking abliterated, uncensored,
  merge, role-play or NSFW variants are excluded.
- The embedded chat template handles tools, and the architecture uses a
  tool-call format that the pinned llama.cpp parses natively. This is a list of
  formats, not of models.
- Template integrity: the template embedded in the quantized file must match the
  official base model's template (normalized hash). Templates can hide
  instructions, and hub scanners have not caught them; for an agent that runs
  tools this check is mandatory.
- File integrity: every file is pinned by size and SHA-256; split GGUFs and
  vision projectors are treated as one unit.

Deduplication: group by the `base_model:quantized:<org/model>` tag (fallback:
GGUF `general.basename` + size label), keep one card per base model, choose the
publisher by priority, rank by downloads summed across the group. Versions map
to quantizations: Light ≈ Q3_K/IQ4, Balanced = Q4_K_M, Quality = Q6_K/Q8_0.

Categories come from tags and metadata: Code, Reasoning, Sees images (vision
projector present).

## Fit and speed estimate (Desktop)

- Memory: weights (file size) + KV cache at the light-mode context (from the GGUF
  header: layers, KV heads, head size, sliding-window layout) + ~0.5–1 GB
  buffers. Compared with free VRAM (full offload), or VRAM + RAM (partial), or
  65–75% of unified memory on Apple Silicon. Above ~85% of usable memory the
  model "Doesn't fit".
- Speed: generation ≈ usable bandwidth × 0.5–0.7 ÷ bytes read per token (active
  parameters for MoE); prefill from a per-device-class table. Once a model has
  run, the measured speeds replace the estimate for all models on that PC
  (scaled by size).
- Labels: "Runs fast" (meets the speed floor: ≥ 20 t/s and warm first token
  ≤ 1 s), "Runs, slower" (10–20 t/s), "Very slow" (< 10 t/s), "Doesn't fit".

## Runtime integration

- Desktop's main process owns one `llama-server` per active model on a random
  loopback port with a per-start API key, `--jinja`, explicit `-c`,
  `--cache-ram`, idle unload, and the models directory under Desktop's data
  folder. Never bound to a non-loopback address.
- Downloads run in Desktop (HTTP range resume, size and SHA-256 check, atomic
  rename), not through `llama-server -hf`.
- Pi uses the existing OpenAI-compatible local provider
  (`packages/adapters/src/pi-local-provider.ts`), pointed at the managed server,
  with light mode enabled for this provider.
- After install, Desktop runs one tool-call check (a fixed request that must
  produce a valid call to a dummy tool). A model that fails is kept installed but
  not assigned, with an explanation.
- If a model fails tool calls repeatedly in real turns, Mycellios tells the user
  and suggests another model.
- Resource guards: refuse to load when estimated memory exceeds the safe budget;
  unload on idle and when contribution or other GPU work needs the memory;
  respect battery saver (ask before loading on battery).

## Privacy and safety

- Prompts and outputs stay on the PC. The catalog request carries no account or
  hardware data; the hardware profile stays on the PC.
- Optional, off by default: anonymous per-turn outcome (model id, hardware tier,
  tool-call success, speeds; never content) to demote failing models in
  "Recommended".
- The engine binary is pinned and hash-verified; llama.cpp upgrades are
  deliberate and re-run the measurements above and the GGUF parser regression
  tests.

## Phases

1. **Engine and one click (Windows first).** Managed `llama-server` (Vulkan/CPU),
   verified model download, Pi light mode, prefix warm-up, tool-call check, the
   one-click dialog with a single computed recommendation from a minimal
   catalog built by the same pipeline, Settings → On your PC. macOS Metal and
   Linux in the same phase if packaging allows.
2. **Catalog and "Browse models".** Daily signed catalog, filters,
   deduplication, fit labels, version selector.
3. **Calibration.** Measured-speed feedback, CUDA on demand, optional anonymous
   outcomes, MLX evaluation on Apple Silicon.

## Phase 1 as built

- **Engine.** `apps/desktop/src/local-models.ts` downloads the pinned llama.cpp b12613 build
  for the platform (Windows Vulkan, macOS arm64/x64, Linux Vulkan) on first use instead of
  shipping it in the installer, checks size and SHA-256 from `local-models.json`, unpacks it
  with the system `tar` into `<userData>/local-models/engine/<version>`, and reads the PC's
  devices with `llama-server --list-devices` ("Checking your PC…").
- **Models.** Four pinned GGUF files (Qwen3.5 0.8B, 2B, 4B; gpt-oss 20B) at fixed Hugging Face
  revisions, downloaded with HTTP range resume and the same checks. This short list is the
  minimal catalog for phase 1; phase 2 replaces it with the generated one.
- **Server.** One `llama-server` for the active model on a random loopback port, with a per-start
  key in a file (never on the command line), `--jinja`, reasoning off, 16k context (32k for
  gpt-oss), 2 GB prompt cache, unloaded after 10 idle minutes, in a Windows Job on Windows.
- **Speed.** After loading, one warm-up request (the first request also compiles GPU kernels and
  measured a fifth of the real speed) and one measured request; the result replaces the
  estimate for that model on that PC and decides the fit and the recommendation.
- **Turns.** The Mico stores provider `device` and the model id. The worker sends the turn to the
  Mico's PC with only that id; Desktop's `DeviceModelRuntime` resolves it to the loopback
  server and runs Pi with at most 12 tool schemas up front and no fallback models. The server
  offers only `DEVICE_MODEL_TOOL_NAMES` (10 built-in tools), which also drops their
  instructions. If the PC is offline, the turn fails with a clear message; it never moves to
  the server, and no Credits are charged.
- **Not yet:** prefix warm-up when a chat opens, the tool-call check after install, the
  generated catalog, CUDA on demand and the measured-speed feedback in real turns.
- **Measured on the reference laptop:** install from a verified local file to measured speed
  in 15 s; Qwen3.5 2B measured 26 tokens/s generation and 407 tokens/s prefill. A real Pi
  turn called `read_file` and answered (first event 8.8 s including the model load); the next
  turn's first token arrived in 0.2 s.
- **End to end in the app** (`npm run dev:desktop`, real API, worker, Desktop relay and
  `llama-server`): "On your PC" installed the model from the picker and the Mico answered
  without any connection or Credits. Light mode sent a ~5.3k-token prompt. The first turn
  took 34 s including the model load and gave a weak, meta answer; the second answered fully
  in 6.9 s from Enter.
- **Findings fixed while qualifying:** the send gate required a connection
  (`threadNeedsModel`); the panel showed a guessed recommendation before the PC was checked;
  the key file stayed on disk after an abrupt exit (now deleted once the server has read it);
  one measurement taken while the GPU was busy downgraded the recommendation (the best
  measurement per model is kept).
- **Optimizations after the first run:**
  - The picker offers "On your PC" for any Mico whose computer choice is "Your PC"
    (`computerMode: dedicated`); `engines.forBot` reported `server` even while turns ran on
    the PC.
  - Opening a chat whose Mico uses a local model loads it (`localModels.warm`). Every load
    sends one tiny request to compile the GPU kernels and restores the prompt the model had
    already read, saved with llama-server's slot save (`--slot-save-path`) on unload and 45 s
    after each turn. Measured: after a reload, a 4.7k-token prompt was reused and the answer
    started in 0.4 s instead of 12 s. Slot files stay in Desktop's profile and are deleted
    with their model.
  - Light prompt: Pi's `light` option drops the long conversation style, the "say what you
    will do first" reminder (small models answered with that line instead of the answer) and
    the work-plan loop; the server leaves out project workflow, teammates, skills, plugins,
    reply guidance and the approval paragraph, and sends the date as one short line. The
    captured prompt before this change was ~3.5k system tokens plus 11 tools (~2.3k).

## Verification

- Unit: catalog filters, deduplication, template-hash check, fit estimate,
  light-mode prompt budget (fails if the light prompt exceeds its budget).
- Desktop: engine install/rollback, download resume and hash rejection,
  loopback-only binding, idle unload, tool-call check.
- Physical, reported per machine and never inferred: the measurement table above
  re-run on Windows iGPU, NVIDIA, Apple Silicon and Linux before each tier is
  marked "Recommended". Machines not measured are reported as not measured.

## Open questions

- Which existing tools make up the light-mode core set, and which groups
  `load_tools` exposes.
- Where the catalog signing key lives (same trust model as Desktop release
  catalogs or a separate key).
