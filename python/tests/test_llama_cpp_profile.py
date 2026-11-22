"""llama.cpp stage profile: measurement shape and role reporting, with a fake runner."""

from __future__ import annotations

import argparse
import re
import unittest

import torch

from distributed_runtime.llama_cpp_profile import PROFILE_SCHEMA, _validate, profile_stage
from distributed_runtime.model import StageModelSpec

# Keys of engineRuntimeMeasurementSchema in src/contracts/engine-runtime-profile.ts.
_MEASUREMENT_KEYS = {"measuredAt", "samples", "confidenceHalfWidthPct", "capacity", "costs", "features"}
_CAPACITY_KEYS = {"contextTokens", "maxLayerCount", "kvBytesPerToken", "maxKvTokens", "usableMemoryBytes"}
_COST_KEYS = {
    "decodeMsPerTokenP50", "decodeMsPerTokenP95", "prefillMsPerTokenP50", "prefillMsPerTokenP95",
    "verifyMsPerTokenP50", "verifyMsPerTokenP95", "decodeScale", "prefillScale",
}


class _Config:
    context_tokens = 512
    max_sequences = 2
    gpu_layers = 0


class _FakeRunner:
    def __init__(self, start: int, end: int, total: int, exact_sizes: list[int]) -> None:
        self.spec = StageModelSpec(model_name="fake", layer_start=start, layer_end=end, total_layers=total, threads=1)
        self.tail = end == total
        self.hidden_size = 4
        self.parameter_bytes = 1_000
        self.config = _Config()
        self.info = {"exact_sizes": exact_sizes, "batch_classes": [exact_sizes], "runtime_abi": "llama.cpp-test"}
        self.position = 0
        self.calls: list[tuple[str, int]] = []

    def begin(self, request_id: int) -> None:
        self.position = 0

    def end(self, request_id: int) -> None:
        self.calls.append(("end", 0))

    def sequence_length(self, request_id: int) -> int:
        return self.position

    def truncate(self, request_id: int, count: int) -> None:
        self.position = count

    def forward_ids(self, request_id: int, values: torch.Tensor) -> torch.Tensor:
        self.calls.append(("ids", values.shape[1]))
        self.position += values.shape[1]
        return torch.zeros((1, values.shape[1], self.hidden_size))

    def forward_ids_with_tokens(self, request_id: int, values: torch.Tensor, *, token_mode: str):
        self.calls.append(("ids+tokens", values.shape[1]))
        self.position += values.shape[1]
        return torch.zeros((1, values.shape[1], 0)), tuple(range(values.shape[1]))

    def forward_hidden(self, request_id: int, values: torch.Tensor, *, token_mode: str):
        self.calls.append(("hidden", values.shape[1]))
        self.position += values.shape[1]
        return values, None


def _args(samples: int = 7) -> argparse.Namespace:
    return argparse.Namespace(
        samples=samples, warmup_samples=1, threads=1,
        reference_decode_ms_per_token=10.0, reference_prefill_ms_per_token=2.0,
    )


class LlamaCppProfileTests(unittest.TestCase):
    def test_measurement_has_the_coordinator_shape(self) -> None:
        result = profile_stage(_FakeRunner(0, 6, 12, [1, 2, 3]), 4096, _args())
        measurement = result["measurement"]

        self.assertEqual(result["schema"], PROFILE_SCHEMA)
        self.assertEqual(set(measurement), _MEASUREMENT_KEYS)
        self.assertEqual(set(measurement["capacity"]), _CAPACITY_KEYS)
        self.assertEqual(set(measurement["costs"]), _COST_KEYS)
        self.assertRegex(measurement["measuredAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
        self.assertEqual(measurement["capacity"]["maxLayerCount"], 6)
        self.assertEqual(measurement["capacity"]["kvBytesPerToken"], 4096)
        self.assertEqual(measurement["capacity"]["usableMemoryBytes"], 1_000 + 4096 * 512 * 2)
        for name, value in measurement["costs"].items():
            self.assertGreater(value, 0, name)
        for name in ("decodeScale", "prefillScale"):
            self.assertTrue(0.01 <= measurement["costs"][name] <= 100)

    def test_roles_follow_the_stage_position(self) -> None:
        cases = {(0, 6, 12): ["head"], (6, 12, 12): ["tail"], (3, 6, 12): ["middle"], (0, 12, 12): ["head", "tail"]}
        for (start, end, total), roles in cases.items():
            with self.subTest(start=start, end=end):
                result = profile_stage(_FakeRunner(start, end, total, [1]), 1024, _args())
                self.assertEqual(result["measurement"]["features"]["roles"], roles)

    def test_exact_speculation_needs_a_multi_size_class(self) -> None:
        self.assertTrue(profile_stage(_FakeRunner(0, 6, 12, [1, 2]), 1, _args())["exactness"]["exactSpeculation"])
        self.assertFalse(profile_stage(_FakeRunner(0, 6, 12, [1]), 1, _args())["exactness"]["exactSpeculation"])

    def test_exactness_reports_the_backend_the_child_found(self) -> None:
        gpu = _FakeRunner(0, 6, 12, [1])
        gpu.info.update(backend="vulkan", gpu_devices=[["vulkan", "AMD Radeon(TM) 890M Graphics"]])
        exactness = profile_stage(gpu, 1, _args())["exactness"]
        self.assertEqual(exactness["backend"], "vulkan")
        self.assertEqual(exactness["gpuDevices"], ["AMD Radeon(TM) 890M Graphics"])
        # An old child that reports no backend ran on the CPU.
        self.assertEqual(profile_stage(_FakeRunner(0, 6, 12, [1]), 1, _args())["exactness"]["backend"], "cpu")

    def test_every_sample_restarts_from_the_same_prompt(self) -> None:
        runner = _FakeRunner(6, 12, 12, [1])
        profile_stage(runner, 1, _args(samples=7))
        sizes = [count for kind, count in runner.calls if kind == "hidden"]
        # Prompt, then decode/prefill/verify series of (1 warm-up + 7 samples).
        self.assertEqual(sizes, [32] + [1] * 8 + [32] * 8 + [8] * 8)
        self.assertEqual(runner.calls[-1], ("end", 0))

    def test_rejects_invalid_arguments(self) -> None:
        for change in ({"samples": 6}, {"warmup_samples": -1}, {"threads": 0},
                       {"reference_decode_ms_per_token": 0.0}, {"reference_prefill_ms_per_token": float("nan")}):
            with self.subTest(change=change):
                args = _args()
                for key, value in change.items():
                    setattr(args, key, value)
                with self.assertRaises(ValueError):
                    _validate(args)


if __name__ == "__main__":
    unittest.main()
