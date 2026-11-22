"""Measure a sealed native GGUF stage executed by llama.cpp, with its real weights.

``engine_runtime_profile.py`` answers Qwen3 challenges with synthetic Torch
kernels. A llama.cpp stage has to be measured as it will run: this module
loads the verified package through :class:`LlamaCppStageRunner` (child process,
view, batch-class self-test) and times one-position decode, prompt prefill and
verification waves through that same path, including the process boundary.

The output has the ``engineRuntimeMeasurement`` shape the coordinator seals
(``src/contracts/engine-runtime-profile.ts``) under ``measurement``, and the
node's exactness under ``exactness``. A stage that cannot load or whose
self-test fails produces an error and no measurement, so a node never reports
a profile for an engine it cannot run.

Usage::

    python -m distributed_runtime.llama_cpp_profile \
        --native-gguf-package PKG --native-gguf-package-id ID \
        --native-gguf-executor llama-cpp --llama-cpp-build-dir DIR \
        --llama-cpp-view-cache DIR [--llama-cpp-gpu-layers N] \
        --reference-decode-ms-per-token MS --reference-prefill-ms-per-token MS
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import statistics
import time
from typing import Callable, Sequence

import numpy as np
import torch

from .llama_cpp_stage_runner import LlamaCppStageRunner
from .model import StageModelSpec
from .native_gguf import NATIVE_GGUF_STAGE_WEIGHTS, parse_gguf, verify_native_gguf_stage
from .native_gguf_runtime import add_native_gguf_arguments, native_gguf_runtime_from_args

PROFILE_SCHEMA = "mycellios-llama-cpp-stage-profile/1"
MINIMUM_SAMPLES = 7
PROMPT_POSITIONS = 32
VERIFY_POSITIONS = 8
_REQUEST = 1


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Measure a llama.cpp native GGUF stage.")
    add_native_gguf_arguments(result)
    result.add_argument("--reference-decode-ms-per-token", type=float, required=True)
    result.add_argument("--reference-prefill-ms-per-token", type=float, required=True)
    result.add_argument("--warmup-samples", type=int, default=2)
    result.add_argument("--samples", type=int, default=21)
    result.add_argument("--threads", type=int, default=4)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    _validate(args)
    runtime = native_gguf_runtime_from_args(args)
    if runtime is None or runtime.llama_cpp is None:
        raise ValueError("the llama.cpp profile needs a native GGUF package and --native-gguf-executor llama-cpp")
    package = verify_native_gguf_stage(runtime.package, expected_package_id=runtime.package_id)
    spec = StageModelSpec(
        model_name="sealed-native-gguf",
        layer_start=package.layer_start,
        layer_end=package.layer_end,
        total_layers=package.total_layers,
        threads=args.threads,
        artifact_identity=package.artifact_identity,
        canonical_model_source=package.model_source,
        canonical_model_revision=package.model_revision,
        stage_package_identity=package.package_identity,
    )
    runner = LlamaCppStageRunner(spec, runtime.package, runtime.package_id, runtime.llama_cpp)
    try:
        result = profile_stage(runner, kv_bytes_per_token(package), args)
    finally:
        runner.close()
    print(json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False))
    return 0


def kv_bytes_per_token(package) -> int:
    """KV bytes per position for the stage's layers, at llama.cpp's default f16 cache."""

    metadata = parse_gguf(package.root / NATIVE_GGUF_STAGE_WEIGHTS).metadata_map()
    architecture = package.architecture
    heads = int(metadata[f"{architecture}.attention.head_count"])
    kv_heads = int(metadata.get(f"{architecture}.attention.head_count_kv", heads))
    head_dim = int(metadata.get(f"{architecture}.attention.key_length", int(metadata[f"{architecture}.embedding_length"]) // heads))
    layers = package.layer_end - package.layer_start
    return 2 * kv_heads * head_dim * 2 * layers


def profile_stage(runner, kv_per_token: int, args: argparse.Namespace) -> dict[str, object]:
    head = runner.spec.layer_start == 0
    rng = np.random.default_rng(20261122)

    def inputs(count: int) -> torch.Tensor:
        if head:
            return torch.from_numpy(rng.integers(3, 1000, size=(1, count), dtype=np.int64))
        return torch.from_numpy(rng.standard_normal((1, count, runner.hidden_size)).astype(np.float32))

    def run(values: torch.Tensor) -> None:
        if head and runner.tail:
            runner.forward_ids_with_tokens(_REQUEST, values, token_mode="all")
        elif head:
            runner.forward_ids(_REQUEST, values)
        else:
            runner.forward_hidden(_REQUEST, values, token_mode="all" if runner.tail else "none")

    runner.begin(_REQUEST)
    try:
        run(inputs(PROMPT_POSITIONS))
        committed = runner.sequence_length(_REQUEST)

        def timed(count: int) -> Callable[[], None]:
            values = inputs(count)

            def operation() -> None:
                runner.truncate(_REQUEST, committed)
                run(values)

            return operation

        decode = _latency_series(timed(1), args.warmup_samples, args.samples, 1)
        prefill = _latency_series(timed(PROMPT_POSITIONS), args.warmup_samples, args.samples, PROMPT_POSITIONS)
        verify = _latency_series(timed(VERIFY_POSITIONS), args.warmup_samples, args.samples, VERIFY_POSITIONS)
    finally:
        runner.end(_REQUEST)

    context_tokens = runner.config.context_tokens
    roles = ["head"] if head else []
    if runner.tail:
        roles.append("tail")
    if not head and not runner.tail:
        roles.append("middle")
    exact_sizes = [int(size) for size in runner.info.get("exact_sizes", [])]
    return {
        "schema": PROFILE_SCHEMA,
        "measurement": {
            "measuredAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "samples": args.samples,
            "confidenceHalfWidthPct": max(decode["confidence"], prefill["confidence"], verify["confidence"]),
            "capacity": {
                "contextTokens": context_tokens,
                "maxLayerCount": runner.spec.layer_end - runner.spec.layer_start,
                "kvBytesPerToken": kv_per_token,
                "maxKvTokens": context_tokens,
                # The stage loaded and ran with this much: weights plus its KV budget.
                "usableMemoryBytes": max(1, runner.parameter_bytes + kv_per_token * context_tokens * runner.config.max_sequences),
            },
            "costs": {
                "decodeMsPerTokenP50": decode["p50"],
                "decodeMsPerTokenP95": decode["p95"],
                "prefillMsPerTokenP50": prefill["p50"],
                "prefillMsPerTokenP95": prefill["p95"],
                "verifyMsPerTokenP50": verify["p50"],
                "verifyMsPerTokenP95": verify["p95"],
                "decodeScale": _scale(decode["p50"], args.reference_decode_ms_per_token),
                "prefillScale": _scale(prefill["p50"], args.reference_prefill_ms_per_token),
            },
            "features": {
                "fastKernel": True,
                "graphMode": "unavailable",
                "roles": roles,
            },
        },
        "exactness": {
            "runtimeAbi": runner.info.get("runtime_abi"),
            "backend": "vulkan" if runner.config.gpu_layers > 0 else "cpu",
            "batchClasses": runner.info.get("batch_classes", []),
            "exactMicroBatchSizes": exact_sizes,
            # A wave is exact only when the self-test found a class with more than one size.
            "exactSpeculation": max(exact_sizes, default=0) > 1,
        },
    }


def _scale(measured: float, reference: float) -> float:
    return max(0.01, min(100.0, measured / reference))


def _latency_series(operation: Callable[[], None], warmups: int, samples: int, tokens: int) -> dict[str, float]:
    for _ in range(warmups):
        operation()
    values: list[float] = []
    for _ in range(samples):
        start = time.perf_counter()
        operation()
        values.append((time.perf_counter() - start) * 1000.0 / tokens)
    values.sort()
    p50 = statistics.median(values)
    p95 = values[min(len(values) - 1, math.ceil(0.95 * len(values)) - 1)]
    deviation = statistics.stdev(values) if len(values) > 1 else 0.0
    confidence = 100.0 * 1.96 * deviation / math.sqrt(len(values)) / p50 if p50 > 0 else 100.0
    return {"p50": p50, "p95": p95, "confidence": min(100.0, confidence)}


def _validate(args: argparse.Namespace) -> None:
    if not MINIMUM_SAMPLES <= args.samples <= 100_000:
        raise ValueError("llama.cpp profile sample count is invalid")
    if not 0 <= args.warmup_samples <= 1_000 or not 1 <= args.threads <= 256:
        raise ValueError("llama.cpp profile bounds are invalid")
    for value in (args.reference_decode_ms_per_token, args.reference_prefill_ms_per_token):
        if not math.isfinite(value) or value <= 0:
            raise ValueError("llama.cpp profile reference costs must be finite and positive")


if __name__ == "__main__":
    raise SystemExit(main())
