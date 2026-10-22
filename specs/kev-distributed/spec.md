# Quantized Kev decisions over the physical Mycellios network

## Requested outcome

Install Kev-4B Q8, execute distinct parts of one decision request on distinct
owned laptops over the Internet, and expose a temporarily free AntSeed offer
named `jev` only after the complete buyer request passes. The description must
identify Kev-4B as the independent underlying model, not TypeSafe's Jev.

## Boundaries

- No inference on PC-DANI. No paid compute, wallet funding or service interruption.
- Preserve Kokoro, embedding migration, their owner reservations and process limits.
- Isolate source work from existing unpublished embedding changes.
- Pin model, compiler, executable and every shard by revision and SHA-256.
- A worker connection, mocked stage, single-host run or distributed independent
  questions does not prove that one request executed a partitioned model.
- Native network stages require owner admission, authenticated transport, bounded
  payloads/deadlines, distinct physical identities and complete stage coverage.
- Preserve the public Mycellios worker admission and AntSeed accounting route.
  Zero price does not remove admission, usage metering or financial gas budgets.

## Initial observations, not benchmark results

The public Q8 artifact is 4,498,493,152 bytes, SHA-256
`51c9353a5ff0b8e2f7cd7262359c0b26ea54b327214fe26a5da52b505b2978e8`,
model revision `9e37a4eb7def2f73a1bd1301218b063a48ad12c9`.
It is a ggmlc graph container, not a llama.cpp model. Its published recipe uses
2048-token context. Source inspected: ggmlc
`5490a13661d95add025ec1b111adbc88234a9b4f`.

Current physical hosts are reachable over NetBird. The NVIDIA cards are RTX 2060
6 GiB and GTX 850M 2 GiB; HP has Iris Xe shared graphics. MRPUCCHI's system disk
has only about 3 GB free. These observations grant no free memory reservation.

## Implementation and acceptance

1. Verify downloaded Q8 bytes and license. Inspect serialized graph and cut at
   complete transformer block boundaries, retaining all live cross-boundary inputs.
2. Produce minimal shard artifacts with only required weights. Bind preprocessing,
   decision head, calibration and option order to the same pinned model.
3. Run an isolated reference on authorized laptops, short/long and English/Spanish
   samples, all choice/score/noul primitives. Reject truncation and invalid inputs.
4. Compare distributed Q8 outputs against same-artifact local reference, including
   probabilities; compare task accuracy against a higher precision reference when
   resources permit. Keep quantization loss distinct from partitioning errors.
5. Prove distinct hosts, stage ranges, artifact hashes, execution times and Internet
   relay use for every stage of one complete request. Test missing stage, malformed
   tensors, timeout, duplicate/reordered stage and recovery via a new request.
6. Measure peak host commit, GPU use, cold/warm latency and end-to-end throughput.
   Recheck Kokoro and embedding health without sending unrelated inference traffic.
7. Integrate typed decision transport with native Mycellios admission and AntSeed.
   Set only `jev` input/cached-input/output prices to zero. Verify a real buyer
   request, complete result, model provenance, token accounting and `served_free=1`.
8. Document exact deployed closure, rollback, public limits, and residual quality
   limitations. Do not publish an offer based on health checks or synthetic tests.
9. Validate parent-process death and an independently enforced native wall deadline
   on each physical Windows host. A child-owned Job alone does not enforce the
   lifetime of its Python controller. Keep this no-model regression separate from
   inference, and requalify the model route after changing the native executable.

## Status

Measured outcomes and remaining evidence gates are recorded in the canonical
[status document](../../docs/STATUS_AND_EVIDENCE.md#experimental-kev-decision-graphs).
This specification describes acceptance criteria, not a public service guarantee.
