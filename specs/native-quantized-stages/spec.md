# Native quantized stages

Status: phase 1 in progress (opened 2026-11-22). The pinned runtime and its
batch-class self-test are merged (#451); stage execution is in review.

## Goal

Run each pipeline stage on quantized weights with llama.cpp's kernels, instead
of dequantizing the stage to fp16 or fp32 and running it through Torch.

A stage keeps the contract it has today: it owns a contiguous layer range,
receives token ids or hidden states, keeps one KV cache per request, supports
VERIFY waves and TRUNCATE, and returns hidden states or tokens.

## Why

Stage compute, not the network, limits the current route on consumer hardware.
`python/distributed_runtime/native_gguf_runtime.py` already stores a stage as a
GGUF package, but it dequantizes every tensor into a Transformers range at
load, so execution is fp16 on accelerators and fp32 on CPU. On Windows GPUs
that are not CUDA the accelerator path is torch-directml, which has had no
release since September 2024.

Measured on one PC (AMD Radeon 890M integrated GPU, SmolLM2-1.7B-Instruct,
single-host loopback, exploratory):

| Path | One decode step, complete model |
|---|---|
| Current: Torch on DirectML, fp16 | 157 ms |
| Current: Torch on DirectML, fp32 | 597 ms |
| llama.cpp b12613, Vulkan, Q4_K_M | 28-34 ms |
| llama.cpp b12613, CPU (4 threads), Q4_K_M | 58-67 ms |

These are single-host numbers. They are not multi-host evidence and make no
claim about other hardware.

## What the prototype established

The prototype drives an unpatched, official llama.cpp release build (b12613)
through its C API. The scripts are not in the repository.

1. **Stage packages need no custom tool.** `llama-quantize --prune-layers ...
   COPY` writes a GGUF that holds only the kept blocks, renumbered from zero,
   without requantizing. Two packages of a 24-block model took about 1.5 s
   each.
2. **A layer range runs through the public API.**
   - `llama_set_embeddings_layer_inp(ctx, k, true)` returns the residual stream
     entering block `k`, before any final norm. That is the hidden state the
     next stage needs.
   - `llama_batch.embd` feeds hidden states instead of tokens, with explicit
     positions.
   - `llama_memory_seq_rm` drops KV positions, which is TRUNCATE.
3. **The split pipeline equals the unsplit model.** A head package (blocks
   0-12, output read at the input of block 12) followed by a tail package
   (blocks 12-23) produced the same greedy tokens as the complete GGUF on 8
   prompts x 48 tokens, on CPU and on Vulkan. The hidden state at the cut was
   bit-identical (maximum absolute difference 0.0).
4. **Rollback is exact.** Decoding positions, removing them with
   `llama_memory_seq_rm` and decoding them again gave bit-identical logits,
   including when the removed positions had held different tokens.
5. **Stage timings** (same PC and model; one decode step):

   | Stage | Vulkan | CPU, 4 threads |
   |---|---|---|
   | Head, blocks 0-11 (+1 extra block, see below) | 16-17 ms | 31-42 ms |
   | Tail, blocks 12-23 | 19-20 ms | 28-37 ms |

   A 17-position wave through the complete model took 44 ms on Vulkan and
   225 ms on the CPU with 6 threads, against 30 ms and 28 ms per position
   when decoded one at a time.

6. **Results depend on the batch size, in classes.** Decoding the same
   positions in batches of different sizes is bit-identical only inside a
   class:
   - CPU (zen4 kernels): sizes 1-7 are one class; 8 and larger differ.
     Cutting a 17-position wave into 7+7+3 gave the same bits as 17 single
     steps and cost 284 ms instead of 225 ms.
   - Vulkan: size 1 is alone and 9 and larger differ. Sizes 2-8 agreed on a
     32-position test but not on a 68-position one (see finding 7), so no
     exact class is established there.

   Between classes the logits move by about 1.0-1.5, which changes the greedy
   token where the top two candidates are close (1-3 positions in 47).
7. **On Vulkan the last block is not row-independent.** With hidden states
   identical up to the input of the last block, the logits of one position
   moved by 0.07-0.2 when a different token shared its batch. The blocks before
   the last one did not show this. The cause is not identified.

For comparison, the current Torch runner has no such classes: every batch size
gives different bits. The difference is about 0.1 in the logits in fp16 on
DirectML and about 0.00006 in fp32 on DirectML or CPU.

## Design

### Executor

A new stage runner implements the existing stage runner contract over a pinned
llama.cpp build:

- one model and one context per stage process;
- one llama.cpp sequence per active request; BEGIN and END map to sequence
  allocation and whole-sequence removal;
- the head stage decodes token ids, other stages decode `embd` batches;
- a non-tail stage reads its output with
  `llama_get_embeddings_layer_inp`; the tail reads logits;
- TRUNCATE maps to `llama_memory_seq_rm`.

The wire protocol, the activation codec, the speculation controller and the
VERIFY conveyor do not change. Hidden states leave llama.cpp as float32 and are
encoded by the existing codec.

llama.cpp runs in its own child process, which never imports Torch. On
Windows, Torch's CPU wheels load Intel OpenMP and the official llama.cpp CPU
backend loads LLVM OpenMP; the two abort when both initialize in one process
(observed with b12613). The stage process keeps the wire protocol and Torch,
and exchanges token ids, hidden states and logits rows with the child over a
local pipe. A wave of 17 positions at hidden size 2048 is about 140 KB. The
separation also keeps a native crash from taking down the stage server, which
can report it and restart the child.

### Stage packages

The sealed package format of `native_gguf.py` does not change. A node
verifies the package as before, then derives a llama.cpp *view* from its
verified bytes (`llama_cpp_view.py`), cached by package id:

- blocks renumbered from zero and the block count rewritten;
- no tokenizer (`tokenizer.ggml.model = none`), with the vocabulary size the
  stage needs: the real size for the head and the tail, one for a middle
  stage. The tokenizer stays with the root, as today.
- tensors the loader requires but the stage does not read: a unit
  `output_norm` for non-tail stages, a one-row token embedding for middle
  stages, and for a tail whose model has a separate output matrix, a token
  embedding copied from that matrix (same shape and type);
- a non-tail view carries a copy of its last block, because the layer input of
  block `k` is only produced when block `k` exists. The copy costs one block of
  compute and memory per stage. An upstream option to stop the graph after a
  given block would remove it.

With SmolLM2-1.7B (Q4_K_M), views of one, two and three stages produced the
same greedy tokens as the original GGUF, on CPU and on Vulkan.

### Exact speculation

Speculation is exact when a position gives the same token whether it was
computed alone or inside a wave. The measurements above give a concrete rule:

- At start, the runner measures its own batch classes with a fixed input and
  keeps the largest class that includes the wave sizes it needs.
- Every decode call uses a micro-batch size from that class. On the CPU
  kernels measured here, any size up to 7 qualifies, including single tokens,
  at about 27 % more time per wave than one large batch.
- Vulkan has no established class. Its blocks before the last one were
  row-independent in the tests, so a non-tail stage may still be exact with
  sizes 2-8; that needs a direct test on the stage output. For the tail, a
  candidate is to read the state after the last real block (through an extra
  block, as in non-tail stages) and compute the final norm and the output
  projection for the top candidates on the CPU with fixed arithmetic. Neither
  is prototyped.

Until this is settled, a Vulkan stage must be reported as approximate under
speculation, as DirectML fp16 is today.

### Planner

The cost model needs measured per-block costs for quantized stages, and stage
memory must come from the GGUF tensor sizes plus the KV for the planned
context. The next section describes how those measurements are produced.

## Operation at network scale

The network is meant to reach thousands of devices. Nothing in this design may
need a person to configure, enable or repair an individual node. Every step
below is driven by the coordinator from current measurements, and mostly
reuses mechanisms that already exist.

### An engine family, not a switch

The native executor is a new engine family in the existing fail-closed seam
(`src/contracts/engine-family.ts`, `src/distribution/engine-family-registry.ts`),
next to `qwen3-dense`. Each descriptor names one model revision and lists its
targets: platform, architecture, backend (`cpu`, `vulkan`, `cuda`, ...), a
`runtimeAbi` naming the exact llama.cpp build and variant, and the accepted
quantizations (for example `Q4_K_M`). A family is usable only while a current
`EngineCertification` exists. Revoking it removes the family from every future
plan at once; nodes then serve the families they still qualify for.

The existing Torch families stay. A node may qualify for both, and the planner
chooses per route from measured costs.

### Binaries

Each target's llama.cpp release artifact is published as a pinned,
content-addressed runtime component (`scripts/publish-runtime-components.mjs`).
A node downloads only the variants its hardware can run and verifies the hash
before loading. The CPU variant loads its instruction-set kernels at runtime
(the release ships one library per CPU generation), so one artifact covers every
x64 CPU. The binding checks `llama.h` struct sizes against the pinned build at
load and refuses to start on a mismatch.

Initial targets: Windows and Linux x64 with `cpu` and `vulkan`, Linux x64 with
`cuda`. Apple GPUs are an open question, because the backend enum has `mps`
but no Metal entry.

### Per-node qualification

The coordinator has the pieces of an engine runtime challenge: a scheduler
that renews each profile an hour before its 24-hour expiry
(`src/coordinator/engine-runtime-profile-scheduler.ts`), a worker handler and
coordinator-side sealing (`engine-profile-authority.ts`). As of 2026-11-22 it
is not connected in production for any engine:

- `buildEngineRuntimeActivationPlans` is never called outside tests, so no
  challenge is ever issued. With an activation authority configured, every
  node would wait for a profile that never arrives.
- The challenge contract admits only the `qwen3-dense-v1` probe on `cuda` or
  `rocm`. Its probe (`engine_runtime_profile.py`) times synthetic `torch.mm`
  kernels and does not load the model.
- Only the headless worker wires a probe; desktop nodes answer
  `engine_runtime_probe_unavailable`. No node detects or reports Vulkan.

For this family the worker answers a challenge with
`python -m distributed_runtime.llama_cpp_profile`. It loads the sealed package
through the same runner as production (pinned binary, view, child process),
runs the batch-class self-test, and times one-position decode, 32-position
prefill and 8-position verification with the real weights. It prints the
existing `engineRuntimeMeasurement` shape plus an `exactness` block: runtime
ABI, backend, batch classes, exact micro-batch sizes, and whether speculation
can be exact. On the development PC (SmolLM2-1.7B, 12-block stages) it
reported 19.7 ms per decoded position on the CPU and 12.9 ms on Vulkan, with
exact speculation on the CPU only.

The sealed `EngineRuntimeProfile` needs that exactness block. Without it a
route may still run, but its speculative output is reported as approximate.

A node that fails any step publishes no profile for this family. It keeps
serving the families it does qualify for, and the failure reason reaches the
coordinator's activation incident. No operator action is needed for a node to
fall back.

What remains before selection is automatic, in order:

1. The contract admits a `llama-cpp-gguf-v1` probe kind on `cpu` and `vulkan`
   and seals the exactness block. The coordinator builds the challenge from the
   package identity instead of Qwen3 shape fields.
2. Both worker kinds wire the probe, and nodes report Vulkan availability.
3. The coordinator builds activation plans after each automatic distribution,
   which is the missing link for every engine family. Done: after a route
   commits, `recordEngineRuntimeActivationPlans` stores one challenge per stage
   member, or clears the model's plans and logs the reason. A serving route is
   never failed by it. This makes renewal work. It does not solve the first
   profile: with an authority configured, planning admits only nodes that
   already hold a profile, so a network without profiles never activates and
   never gets plans. Decided 2026-11-22 and done: while fewer nodes than the
   minimum stage count hold a current engine profile, the coordinator plans
   from runtime performance profiles alone, without engine-bound link
   evidence. That route's challenges create the profiles, and later
   activations return to the strict rule.
4. The Python launcher and the launch agent accept `--native-gguf-executor
   llama-cpp` only when it is bound to the sealed engine authority. The stage
   artifact preparer supplies the pinned build directory and the view cache.
5. Requested models gain a pinned GGUF source, and nodes build their stage
   packages from it. The pin lives in the engine activation authority, not in
   the requested-model table, so it needs no migration and is bound by the
   same certification: its optional `artifact` names the GGUF's HTTPS URL,
   SHA-256 and size, and the URL and id of its tensor manifest
   (`src/contracts/gguf-tensor-manifest.ts`, whose identity matches the
   Python node byte for byte). The authority is valid only when the certified
   `descriptor.model.manifestDigest` is that manifest's id. Still open: the
   worker preparer fetching the manifest and calling
   `native_gguf_remote fetch-stage`.

### Planning

The planner rules do not change; their inputs become measured:

- One node when the model fits (`minimumNodes: 1` is accepted since #440).
  Quantized weights are about a quarter of fp16, so most models up to about 8B
  parameters fit one consumer GPU and run as replicas.
- Otherwise the fewest large stages, using each node's profile costs and
  capacity.
- One engine family and one quantization per route. Stages exchange hidden
  states, and those must come from the same weights.
- Speculation is enabled on a route only when every stage reports an exact
  micro-batch class covering the wave, or the request accepts approximate
  output.

### Stage packages

At scale, packages must be cheap to build and reusable across nodes:

- Cut points come from a small fixed set per model, for example every eighth
  of the blocks. Two nodes holding the same range then hold the same package.
- A node builds its own package from the published model GGUF. Done in
  `native_gguf_remote.py`: the coordinator publishes a content-addressed
  *tensor manifest* computed once from the complete file (artifact SHA-256 and
  size, header SHA-256, every tensor's offset, size and SHA-256, and the exact
  `config.json` text). A node fetches the header and its stage's tensors with
  HTTPS range requests, checks each against the manifest and builds the
  package. The result is byte-identical to a package built from the complete
  file. For SmolLM2-1.7B (Q4_K_M, 1056 MB) a 12-block stage fetched 559-581 MB
  and an 8-block middle stage 326 MB; a tail fetched from Hugging Face over
  HTTPS had the same package id as the local build.
- The package identity is its content hash, as today. The coordinator can name
  a package in a challenge without having built it.
- Packages are cached under the owner's disk limit and evicted least recently
  used.

### Loading on demand

`specs/on-demand-replica-placement/spec.md` already loads and releases native
replicas from demand, with minimum residency and no thrashing. It is configured
per replica today. Serving thousands of nodes needs the same ledger and planner
driven by engine profiles instead of a configured list. That generalization is
a separate change, and this spec depends on it for automatic multi-model
placement.

### Verification and settlement

Text canaries today prove that a deployment completed requests at a measured
speed, bound to the worker, session, activation and model digest
(`src/contracts/deployment-canary.ts`). They do not compare output content, so
a quantized artifact fits as long as the canary binds to its digest.

Any check that compares output content must not require bits to match across
backends. CPU, Vulkan and CUDA builds differ, and so do batch classes on one
backend (about 1.0-1.5 in the logits, finding 6). Such a check either:

- recomputes on the same backend, `runtimeAbi` and micro-batch class; or
- compares tokens only where the reference's top-two margin exceeds a stated
  threshold, and treats the rest as unverifiable rather than wrong.

This applies to certification parity evidence and to any future spot-check of
contributor work.

### Rollout and reversal

- A family is first certified for one target and a capped number of nodes.
  The cap is raised as routes complete without fallback.
- The signals to watch are challenge failures by reason and target, routes
  falling back to Torch, the fraction of requests served unsplit, and
  per-family token rate.
- Revoking a certification reverses everything. Plans stop using the family
  immediately, and running routes drain normally.

## Phases

1. **Runner and qualification on CPU.** Binding to a pinned build, the stage
   runner, the challenge handler and the batch-class self-test, behind the
   engine-family seam (no manual flag). Exit: on one host, a two-stage route
   answers with the same tokens as the complete GGUF on the copy and chat
   corpora, with and without speculation, and a node with a mismatched binary
   or a failing self-test publishes no profile.

   Done so far: the pinned runtime and self-test (#451), the view, the
   Torch-free executor and the stage runner, selected with
   `--native-gguf-executor llama-cpp` on the server and stage processes. On
   one host, a two-stage loopback route returned the same text with and
   without speculation (64 of 64 answers, CPU and Vulkan). Still open: the
   engine runtime challenge handler and engine-family selection, which replace
   the flag.
2. **Packages.** Tensor-range package builder with the fixed cut points and the
   middle-stage vocabulary, cache and eviction. Exit: two nodes build
   byte-identical packages for the same range.
3. **Vulkan.** Pinned GPU artifacts; settle finding 7 or report Vulkan routes as
   approximate under speculation.
4. **Two physical computers.** Exit: a measurement over native transport,
   recorded in `docs/STATUS_AND_EVIDENCE.md`.
5. **Network rollout.** Certification for a capped set of nodes, the
   generalized on-demand placement, then retiring torch-directml.

## Open questions

- Why the last block on Vulkan depends on the other rows in the batch, and
  whether it also happens on CUDA and Metal.
- Concurrent requests share micro-batches today. Batch classes were measured
  for one sequence only.
- Which architectures to certify first. The prototype covers the Llama
  architecture only; the current adapters also certify Qwen3.
- Sampling needs the logits, not only the greedy token. They are available
  from the tail, but the lossless sampling path is not prototyped.
- Context size and KV precision per stage.
- How Apple GPUs are named in the backend enum (`mps` or a new `metal`).
- Whether a route may mix backends when speculation is off.
- The margin threshold for content checks across backends.
