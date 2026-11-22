"""Pinned llama.cpp stage runtime.

The pure tests need only numpy. The physical test runs when
``MYCELLIOS_LLAMA_CPP_DIR`` names a directory holding exactly a pinned build
and ``MYCELLIOS_LLAMA_CPP_MODEL`` names a complete Llama-architecture GGUF; it
is skipped otherwise and never downloads anything.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from distributed_runtime.llama_cpp_runtime import (
    PINNED_BUILDS,
    LlamaCppRuntimeError,
    LlamaCppStageOptions,
    PinnedLlamaCppBuild,
    batch_class_report,
    group_batch_classes,
    measure_batch_classes,
    plan_micro_batches,
    verify_build_directory,
)


def _fake_build(files: dict[str, bytes]) -> PinnedLlamaCppBuild:
    return PinnedLlamaCppBuild(
        build="b0",
        target="test",
        archive_sha256="0" * 64,
        archive_url="https://example.invalid/llama.zip",
        archive_size=1,
        library_name="llama.dll",
        ggml_name="ggml.dll",
        libraries={name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
    )


class BuildPinTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.files = {"llama.dll": b"llama", "ggml.dll": b"ggml", "ggml-cpu-x64.dll": b"cpu"}
        for name, data in self.files.items():
            (self.root / name).write_bytes(data)
        self.build = _fake_build(self.files)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def test_accepts_exactly_the_pinned_libraries(self) -> None:
        (self.root / "README.md").write_text("not a library", encoding="utf-8")
        self.assertEqual(verify_build_directory(self.root, self.build), self.root)

    def test_rejects_a_changed_library(self) -> None:
        (self.root / "ggml-cpu-x64.dll").write_bytes(b"patched")
        with self.assertRaisesRegex(LlamaCppRuntimeError, "hash_mismatch:ggml-cpu-x64.dll"):
            verify_build_directory(self.root, self.build)

    def test_rejects_a_missing_library(self) -> None:
        (self.root / "ggml.dll").unlink()
        with self.assertRaisesRegex(LlamaCppRuntimeError, "library_is_missing:ggml.dll"):
            verify_build_directory(self.root, self.build)

    def test_rejects_an_extra_loadable_library(self) -> None:
        # The backend loader would pick up any ggml library in the directory.
        for name in ("ggml-cuda.dll", "libextra.so", "extra.dylib"):
            with self.subTest(name=name):
                (self.root / name).write_bytes(b"extra")
                with self.assertRaisesRegex(LlamaCppRuntimeError, "unpinned_library"):
                    verify_build_directory(self.root, self.build)
                (self.root / name).unlink()

    def test_rejects_a_missing_directory(self) -> None:
        with self.assertRaisesRegex(LlamaCppRuntimeError, "directory_is_missing"):
            verify_build_directory(self.root / "absent", self.build)

    def test_pinned_builds_are_complete(self) -> None:
        for key, build in PINNED_BUILDS.items():
            with self.subTest(build=key):
                self.assertEqual(build.runtime_abi, key)
                self.assertIn(build.library_name, build.libraries)
                self.assertIn(build.ggml_name, build.libraries)
                self.assertRegex(build.archive_sha256, r"^[0-9a-f]{64}$")
                for digest in build.libraries.values():
                    self.assertRegex(digest, r"^[0-9a-f]{64}$")


class BatchClassTests(unittest.TestCase):
    def test_groups_bit_identical_results(self) -> None:
        a = np.array([1.0, 2.0], dtype=np.float32)
        b = np.array([1.0, 2.0000002], dtype=np.float32)
        classes = group_batch_classes({1: a, 2: a.copy(), 8: b, 9: b.copy(), 3: a.copy()})
        self.assertEqual(classes, ((1, 2, 3), (8, 9)))

    def test_exact_sizes_are_the_class_of_single_token_decoding(self) -> None:
        a = np.zeros(4, dtype=np.float32)
        b = np.ones(4, dtype=np.float32)
        report = batch_class_report({1: a, 2: a, 7: a, 8: b, 16: b})
        self.assertEqual(report.exact_sizes, (1, 2, 7))
        self.assertEqual(report.max_exact_size, 7)

    def test_a_backend_where_single_tokens_stand_alone_has_one_exact_size(self) -> None:
        # Observed on Vulkan: size 1 differs from every wave size.
        a, b = np.zeros(2, dtype=np.float32), np.ones(2, dtype=np.float32)
        report = batch_class_report({1: a, 2: b, 8: b})
        self.assertEqual(report.exact_sizes, (1,))
        self.assertEqual(report.max_exact_size, 1)

    def test_requires_single_token_decoding(self) -> None:
        with self.assertRaisesRegex(ValueError, "one-token"):
            batch_class_report({2: np.zeros(1)})

    def test_measurement_decodes_the_same_tokens_per_size(self) -> None:
        calls: list[tuple[int, ...]] = []
        resets: list[int] = []

        def decode(chunk):
            calls.append(tuple(chunk))
            # Results depend on the chunk length past 4, like a kernel switch.
            bias = 0.5 if len(chunk) > 4 else 0.0
            return np.array([[token + bias] for token in chunk], dtype=np.float32)

        report = measure_batch_classes(decode, lambda: resets.append(1), [10, 11, 12, 13, 14, 15], [2, 4, 6])
        self.assertEqual(report.classes, ((1, 2, 4), (6,)))
        self.assertEqual(len(resets), 4)
        self.assertEqual(calls[:6], [(10,), (11,), (12,), (13,), (14,), (15,)])
        self.assertIn((14, 15), calls)  # size 4 ends with a shorter chunk

    def test_measurement_rejects_empty_tokens(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least one token"):
            measure_batch_classes(lambda chunk: np.zeros((len(chunk), 1)), lambda: None, [], [2])


class MicroBatchPlanTests(unittest.TestCase):
    def test_cuts_a_wave_into_the_fewest_exact_chunks(self) -> None:
        self.assertEqual(plan_micro_batches(17, 7), (7, 7, 3))
        self.assertEqual(plan_micro_batches(14, 7), (7, 7))
        self.assertEqual(plan_micro_batches(3, 7), (3,))
        self.assertEqual(plan_micro_batches(5, 1), (1, 1, 1, 1, 1))

    def test_rejects_invalid_sizes(self) -> None:
        for count, size in ((0, 4), (4, 0), (-1, 2), (3, -2)):
            with self.subTest(count=count, size=size):
                with self.assertRaises(ValueError):
                    plan_micro_batches(count, size)


class StageOptionTests(unittest.TestCase):
    def test_rejects_invalid_options(self) -> None:
        for options in (
            {"threads": 0},
            {"context_tokens": 0},
            {"batch_tokens": -1},
            {"max_sequences": 0},
            {"gpu_layers": -1},
            {"output_layer": -1},
            {"threads": True},
        ):
            with self.subTest(options=options):
                with self.assertRaises(ValueError):
                    LlamaCppStageOptions(**options)


_BUILD_DIR = os.environ.get("MYCELLIOS_LLAMA_CPP_DIR")
_MODEL = os.environ.get("MYCELLIOS_LLAMA_CPP_MODEL")
_BUILD_KEY = os.environ.get("MYCELLIOS_LLAMA_CPP_BUILD", "llama.cpp-b12613-win-vulkan-x64")
_MODULE = Path(__file__).resolve().parents[1] / "distributed_runtime" / "llama_cpp_runtime.py"

# Runs in a separate interpreter that never imports Torch: on Windows, Torch's
# Intel OpenMP and llama.cpp's LLVM OpenMP cannot initialize in one process.
_PHYSICAL_CHECKS = r'''
import importlib.util, json, sys
import numpy as np
spec = importlib.util.spec_from_file_location("llama_cpp_runtime", sys.argv[1])
rt = importlib.util.module_from_spec(spec); sys.modules["llama_cpp_runtime"] = rt; spec.loader.exec_module(rt)
assert "torch" not in sys.modules
library = rt.LlamaCppLibrary.load(sys.argv[2], rt.PINNED_BUILDS[sys.argv[3]])
stage = rt.LlamaCppStage(library, sys.argv[4], rt.LlamaCppStageOptions(
    gpu_layers=int(sys.argv[5]), threads=4, context_tokens=1024, max_sequences=2))
prompt = [1, 9690, 198, 2683, 359, 253, 5356, 5646, 11173, 3365, 3511, 308, 34519, 28, 7018, 411, 407, 19712, 8182, 2]
result = {}
stage.begin(1)
stage.forward_tokens(1, prompt, logits_rows="none")
first = stage.forward_tokens(1, [260, 1352, 3364]).logits
stage.truncate(1, len(prompt))
stage.forward_tokens(1, [42, 43], logits_rows="none")
stage.truncate(1, len(prompt))
again = stage.forward_tokens(1, [260, 1352, 3364]).logits
result["redecode_identical"] = bool(np.array_equal(first, again))
result["length"] = stage.sequence_length(1)
stage.begin(2)
stage.forward_tokens(2, prompt[:5], logits_rows="none")
result["second_length"] = stage.sequence_length(2)
try:
    stage.begin(3)
    result["capacity_error"] = None
except rt.LlamaCppRuntimeError as error:
    result["capacity_error"] = str(error)
stage.end(1); stage.end(2)
report = rt.measure_stage_batch_classes(stage, prompt, (prompt * 2)[:17], range(1, 18))
result["classes"] = [list(group) for group in report.classes]
result["exact_sizes"] = list(report.exact_sizes)
stage.close()
print(json.dumps(result))
'''


@unittest.skipUnless(_BUILD_DIR and _MODEL, "pinned llama.cpp build and GGUF model are not configured")
class PhysicalStageTests(unittest.TestCase):
    """A complete model on one stage: lifecycle, truncation and the self-test."""

    def test_stage_in_a_torch_free_process(self) -> None:
        import json
        import subprocess
        import sys

        gpu_layers = os.environ.get("MYCELLIOS_LLAMA_CPP_GPU_LAYERS", "0")
        completed = subprocess.run(
            [sys.executable, "-I", "-B", "-c", _PHYSICAL_CHECKS, str(_MODULE), _BUILD_DIR, _BUILD_KEY, _MODEL, gpu_layers],
            capture_output=True, text=True, timeout=900, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr[-2000:])
        result = json.loads(completed.stdout.strip().splitlines()[-1])
        self.assertTrue(result["redecode_identical"])
        self.assertEqual(result["length"], 23)
        self.assertEqual(result["second_length"], 5)
        self.assertEqual(result["capacity_error"], "llama_cpp_sequence_capacity_exhausted")
        self.assertIn(1, result["exact_sizes"])
        print(f"\nbatch classes: {result['classes']}", flush=True)


if __name__ == "__main__":
    unittest.main()
