# Native quantized stages

Status: design and feasibility prototype (opened 2026-11-22). No runtime code
has been merged for this spec.

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

### Stage packages

The stage package identity and manifest of `native_gguf.py` stay. The GGUF
inside a package must also load in llama.cpp:

- blocks renumbered from zero and the block count rewritten;
- `token_embd` and `output_norm` present in every package, because the loader
  requires them. A middle stage does not need the real embedding matrix, so
  its package should carry a one-token vocabulary. This is not prototyped.
- a non-tail package carries one block more than its range, because the layer
  input of block `k` is only produced when block `k` exists. The extra block
  costs one block of compute and memory per stage. An upstream option to stop
  the graph after a given block would remove it.

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

### Distribution

llama.cpp is MIT licensed. The runtime pins exact release artifacts per
platform by hash, as the wheel locks do, and records them in `THIRD_PARTY.md`.
`llama.h` struct layouts change between builds, so the binding is generated for
the pinned build and checks struct sizes at load.

### Planner

The cost model needs measured per-block costs for quantized stages, and stage
memory must come from the GGUF tensor sizes plus the KV for the planned
context. No planner change is part of the first phase.

## Phases

1. **Binding and runner, one host, CPU.** Explicit opt-in flag. Exit: a
   two-stage loopback route answers with the same tokens as the complete GGUF
   on the existing copy and chat corpora, with and without speculation.
2. **Exact speculation policy.** Batch-class self-test and micro-batching.
   Exit: speculative and non-speculative answers are identical on CPU; the
   Vulkan tail is either exact or reported as approximate.
3. **Vulkan and packages.** Package writer with the middle-stage vocabulary;
   pinned artifacts. Exit: the same route on a GPU.
4. **Two physical computers.** Exit: a measurement over native transport,
   recorded in `docs/STATUS_AND_EVIDENCE.md`.
5. **Launcher and planner.** Certified engine profile, cost profile, then
   retire torch-directml.

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
