"""llama.cpp execution of sealed native GGUF stage packages.

The view and executor tests use tiny synthetic GGUF files and a fake stage, so
they need neither a llama.cpp binary nor a model. The physical test runs a
two-stage split against a one-stage reference when ``MYCELLIOS_LLAMA_CPP_DIR``,
``MYCELLIOS_LLAMA_CPP_MODEL`` (a complete Llama GGUF) and
``MYCELLIOS_LLAMA_CPP_CONFIG`` (its Hugging Face ``config.json``) are set.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np

from distributed_runtime import llama_cpp_executor as protocol
from distributed_runtime.llama_cpp_runtime import BatchClassReport, StageOutput
from distributed_runtime.llama_cpp_view import LLAMA_CPP_VIEW_VERSION, ensure_llama_cpp_view, llama_cpp_view_path
from distributed_runtime.native_gguf import NativeGgufError, build_native_gguf_stage, parse_gguf
from distributed_runtime.native_gguf_runtime import add_native_gguf_arguments, native_gguf_runtime_from_args
from tests.test_native_gguf import _write_config, _write_gguf

_HIDDEN = 4
_VOCAB = 8


def _tensor(fill: float, dimensions: tuple[int, ...]) -> tuple[int, tuple[int, ...], bytes]:
    count = int(np.prod(dimensions))
    values = np.arange(count, dtype=np.float32) + np.float32(fill)
    return 0, dimensions, values.tobytes()


def _model_tensors(layers: int, *, tied: bool = False) -> dict[str, tuple[int, tuple[int, ...], bytes]]:
    tensors = {
        "token_embd.weight": _tensor(1000.0, (_HIDDEN, _VOCAB)),
        "output_norm.weight": _tensor(2000.0, (_HIDDEN,)),
    }
    if not tied:
        tensors["output.weight"] = _tensor(3000.0, (_HIDDEN, _VOCAB))
    for layer in range(layers):
        tensors[f"blk.{layer}.attn_norm.weight"] = _tensor(100.0 * layer, (_HIDDEN,))
        tensors[f"blk.{layer}.attn_q.weight"] = _tensor(100.0 * layer + 50.0, (_HIDDEN, _HIDDEN))
    return tensors


class _Fixture:
    def __init__(self, root: Path, *, layers: int = 3, tied: bool = False) -> None:
        self.root = root
        self.layers = layers
        self.source = root / "model.gguf"
        self.config = _write_config(root, layers=layers, hidden=_HIDDEN)
        self.tensors = _model_tensors(layers, tied=tied)
        _write_gguf(self.source, layers=layers, hidden=_HIDDEN, tensors=self.tensors)

    def package(self, start: int, end: int):
        return build_native_gguf_stage(
            self.source,
            self.root / f"stage-{start}-{end}",
            config_source=self.config,
            layer_start=start,
            layer_end=end,
            model_source="hf://fixture/model",
            model_revision="a" * 40,
        )

    def payload(self, name: str) -> bytes:
        return self.tensors[name][2]


def _view_tensors(path: Path) -> dict[str, tuple[tuple[int, ...], int, bytes]]:
    document = parse_gguf(path)
    result = {}
    with path.open("rb") as handle:
        for tensor in document.tensors:
            handle.seek(tensor.data_offset)
            result[tensor.name] = (tensor.dimensions, tensor.ggml_type, handle.read(tensor.size_bytes))
    return result


class LlamaCppViewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.cache = self.root / "views"

    def tearDown(self) -> None:
        self.directory.cleanup()

    def test_head_stage_renumbers_blocks_and_adds_the_output_block(self) -> None:
        fixture = _Fixture(self.root)
        view = ensure_llama_cpp_view(fixture.package(0, 2), self.cache)
        tensors = _view_tensors(view.path)
        metadata = parse_gguf(view.path).metadata_map()

        self.assertEqual((view.block_count, view.output_block, view.vocabulary_size), (3, 2, _VOCAB))
        self.assertEqual(metadata["llama.block_count"], 3)
        self.assertEqual(metadata["llama.vocab_size"], _VOCAB)
        self.assertEqual(metadata["tokenizer.ggml.model"], "none")
        self.assertEqual(metadata["mycellios.llama_cpp_view.version"], LLAMA_CPP_VIEW_VERSION)
        self.assertEqual(tensors["token_embd.weight"][2], fixture.payload("token_embd.weight"))
        for index in (0, 1):
            self.assertEqual(tensors[f"blk.{index}.attn_q.weight"][2], fixture.payload(f"blk.{index}.attn_q.weight"))
        # The extra block is a copy of the last real block.
        self.assertEqual(tensors["blk.2.attn_q.weight"][2], fixture.payload("blk.1.attn_q.weight"))
        self.assertEqual(
            np.frombuffer(tensors["output_norm.weight"][2], dtype=np.float32).tolist(),
            [1.0] * _HIDDEN,
        )
        self.assertNotIn("output.weight", tensors)

    def test_middle_stage_uses_a_one_token_vocabulary(self) -> None:
        fixture = _Fixture(self.root)
        view = ensure_llama_cpp_view(fixture.package(1, 2), self.cache)
        tensors = _view_tensors(view.path)

        self.assertEqual((view.block_count, view.output_block, view.vocabulary_size), (2, 1, 1))
        self.assertEqual(tensors["token_embd.weight"][0], (_HIDDEN, 1))
        self.assertEqual(tensors["blk.0.attn_q.weight"][2], fixture.payload("blk.1.attn_q.weight"))
        self.assertEqual(tensors["blk.1.attn_q.weight"][2], fixture.payload("blk.1.attn_q.weight"))

    def test_tail_stage_keeps_its_output_and_borrows_an_embedding_shape(self) -> None:
        fixture = _Fixture(self.root)
        view = ensure_llama_cpp_view(fixture.package(2, 3), self.cache)
        tensors = _view_tensors(view.path)

        self.assertTrue(view.tail)
        self.assertEqual((view.block_count, view.vocabulary_size), (1, _VOCAB))
        self.assertEqual(tensors["blk.0.attn_q.weight"][2], fixture.payload("blk.2.attn_q.weight"))
        self.assertEqual(tensors["output_norm.weight"][2], fixture.payload("output_norm.weight"))
        # A separate output matrix supplies the required embedding shape.
        self.assertEqual(tensors["token_embd.weight"][2], fixture.payload("output.weight"))
        self.assertNotIn("output.weight", tensors)

    def test_tail_stage_with_tied_weights_keeps_the_embedding(self) -> None:
        fixture = _Fixture(self.root, tied=True)
        view = ensure_llama_cpp_view(fixture.package(2, 3), self.cache)
        tensors = _view_tensors(view.path)

        self.assertEqual(tensors["token_embd.weight"][2], fixture.payload("token_embd.weight"))
        self.assertNotIn("output.weight", tensors)

    def test_complete_model_view_keeps_both_matrices(self) -> None:
        fixture = _Fixture(self.root)
        view = ensure_llama_cpp_view(fixture.package(0, 3), self.cache)
        tensors = _view_tensors(view.path)

        self.assertEqual((view.block_count, view.output_block), (3, None))
        self.assertEqual(tensors["token_embd.weight"][2], fixture.payload("token_embd.weight"))
        self.assertEqual(tensors["output.weight"][2], fixture.payload("output.weight"))

    def test_view_is_cached_by_package_identity(self) -> None:
        fixture = _Fixture(self.root)
        package = fixture.package(0, 2)
        first = ensure_llama_cpp_view(package, self.cache)
        modified = first.path.stat().st_mtime_ns
        second = ensure_llama_cpp_view(package, self.cache)

        self.assertEqual(first, second)
        self.assertEqual(second.path.stat().st_mtime_ns, modified)
        self.assertEqual(first.path, llama_cpp_view_path(package, self.cache))
        self.assertEqual([entry.name for entry in self.cache.iterdir()], [first.path.name])

    def test_rejects_stage_weights_that_changed_after_sealing(self) -> None:
        fixture = _Fixture(self.root)
        package = fixture.package(0, 2)
        weights = package.root / "native-stage.gguf"
        data = bytearray(weights.read_bytes())
        data[-1] ^= 0xFF
        weights.write_bytes(bytes(data))
        with self.assertRaisesRegex(NativeGgufError, "differ from the sealed package"):
            ensure_llama_cpp_view(package, self.cache)


class _FakeStage:
    """Records chunk sizes; logits make argmax equal to the input id + 1."""

    def __init__(self, *, tail: bool, hidden: int = 3, vocabulary: int = 16) -> None:
        self.calls: list[int] = []
        self.hidden_size = hidden
        self.vocabulary_size = vocabulary
        self.positions: dict[int, int] = {}

        class _Options:
            output_layer = None if tail else 5

        self.options = _Options()

    def begin(self, request_id: int) -> None:
        if request_id in self.positions:
            raise ValueError("already began")
        self.positions[request_id] = 0

    def end(self, request_id: int) -> None:
        self.positions.pop(request_id, None)

    def truncate(self, request_id: int, count: int) -> None:
        self.positions[request_id] = count

    def sequence_length(self, request_id: int) -> int:
        return self.positions[request_id]

    def forward_tokens(self, request_id: int, tokens, *, logits_rows: str = "all") -> StageOutput:
        tokens = np.asarray(tokens)
        self.calls.append(len(tokens))
        self.positions[request_id] += len(tokens)
        if self.options.output_layer is not None:
            return StageOutput(hidden=np.repeat(tokens[:, None], self.hidden_size, axis=1).astype(np.float32), logits=None)
        if logits_rows == "none":
            return StageOutput(hidden=None, logits=None)
        logits = np.zeros((len(tokens), self.vocabulary_size), dtype=np.float32)
        logits[np.arange(len(tokens)), (tokens + 1) % self.vocabulary_size] = 1.0
        return StageOutput(hidden=None, logits=logits)

    def forward_hidden(self, request_id: int, hidden, *, logits_rows: str = "all") -> StageOutput:
        return self.forward_tokens(request_id, np.asarray(hidden)[:, 0].astype(np.int64), logits_rows=logits_rows)


def _executor(stage: _FakeStage, *, head: bool, max_exact: int, window: int = 8):
    from distributed_runtime import llama_cpp_runtime

    executor = protocol._Executor.__new__(protocol._Executor)
    executor.runtime = llama_cpp_runtime
    executor.stage = stage
    executor.head = head
    executor.exact_window = window
    executor.report = BatchClassReport(classes=((1,),), exact_sizes=tuple(range(1, max_exact + 1)))
    executor.max_exact = max_exact
    return executor


def _serve(executor, requests: list[tuple]) -> list[tuple[int, int, int, bytes]]:
    source = io.BytesIO()
    for op, request_id, kwargs in requests:
        protocol.write_request(source, op, request_id, **kwargs)
    source.seek(0)
    sink = io.BytesIO()
    executor.serve(source, sink)
    sink.seek(0)
    responses = []
    while sink.tell() < len(sink.getvalue()):
        responses.append(protocol.read_response(sink))
    return responses


class ExecutorTests(unittest.TestCase):
    def test_frames_round_trip_and_reject_bad_magic(self) -> None:
        stream = io.BytesIO()
        protocol.write_request(stream, protocol.OP_TOKENS, -7, mode=protocol.MODE_ALL, arg=3, payload=b"abc")
        stream.seek(0)
        self.assertEqual(protocol.read_request(stream), (protocol.OP_TOKENS, protocol.MODE_ALL, -7, 3, b"abc"))
        with self.assertRaises(ValueError):
            protocol.read_request(io.BytesIO(b"XXXX" + bytes(protocol.REQUEST_HEADER.size - 4)))
        with self.assertRaises(EOFError):
            protocol.read_request(io.BytesIO(b"LCQ1"))

    def test_waves_are_cut_into_exact_chunks_and_prefill_runs_whole(self) -> None:
        stage = _FakeStage(tail=True)
        executor = _executor(stage, head=True, max_exact=3, window=8)
        tokens = np.arange(7, dtype=np.int32)
        prefill = np.arange(12, dtype=np.int32) % 16
        responses = _serve(executor, [
            (protocol.OP_BEGIN, 1, {}),
            (protocol.OP_TOKENS, 1, {"mode": protocol.MODE_NONE, "payload": prefill.tobytes()}),
            (protocol.OP_TOKENS, 1, {"mode": protocol.MODE_ALL, "payload": tokens.tobytes()}),
            (protocol.OP_TOKENS, 1, {"mode": protocol.MODE_LAST, "payload": tokens[:2].tobytes()}),
            (protocol.OP_CLOSE, 0, {}),
        ])

        self.assertEqual(stage.calls, [12, 3, 3, 1, 2])
        self.assertEqual(responses[1][1], protocol.KIND_EMPTY)
        status, kind, rows, data = responses[2]
        self.assertEqual((status, kind, rows), (protocol.STATUS_OK, protocol.KIND_TOKENS, 7))
        self.assertEqual(np.frombuffer(data, dtype=np.int32).tolist(), [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(np.frombuffer(responses[3][3], dtype=np.int32).tolist(), [2])
        self.assertEqual(json.loads(responses[4][3]), {"closed": True})

    def test_non_tail_stage_returns_hidden_rows(self) -> None:
        stage = _FakeStage(tail=False, hidden=3)
        executor = _executor(stage, head=False, max_exact=2)
        hidden = np.repeat(np.arange(5, dtype=np.float32)[:, None], 3, axis=1)
        responses = _serve(executor, [
            (protocol.OP_BEGIN, 2, {}),
            (protocol.OP_HIDDEN, 2, {"mode": protocol.MODE_ALL, "payload": hidden.tobytes()}),
            (protocol.OP_CLOSE, 0, {}),
        ])

        status, kind, rows, data = responses[1]
        self.assertEqual((status, kind, rows), (protocol.STATUS_OK, protocol.KIND_HIDDEN, 5))
        self.assertEqual(np.frombuffer(data, dtype=np.float32).reshape(5, 3).tolist(), hidden.tolist())
        self.assertEqual(stage.calls, [2, 2, 1])

    def test_errors_are_reported_and_the_loop_continues(self) -> None:
        stage = _FakeStage(tail=True)
        executor = _executor(stage, head=True, max_exact=4)
        responses = _serve(executor, [
            (protocol.OP_BEGIN, 1, {}),
            (protocol.OP_BEGIN, 1, {}),
            (99, 1, {}),
            (protocol.OP_TRUNCATE, 1, {"arg": 0}),
            (protocol.OP_CLOSE, 0, {}),
        ])

        self.assertEqual(responses[0][0], protocol.STATUS_OK)
        self.assertEqual(responses[1][0], protocol.STATUS_ERROR)
        self.assertIn("already began", json.loads(responses[1][3])["error"])
        self.assertEqual(responses[2][0], protocol.STATUS_ERROR)
        self.assertEqual(responses[3][0], protocol.STATUS_OK)

    def test_executor_imports_nothing_from_the_package(self) -> None:
        # The child loads this file by path in a process without Torch.
        source = Path(protocol.__file__).read_text(encoding="utf-8")
        self.assertNotIn("import torch", source)
        self.assertNotIn("from .", source)
        self.assertNotIn("distributed_runtime", source.split('"""', 2)[2])


class LaunchArgumentTests(unittest.TestCase):
    def _parse(self, *extra: str):
        import argparse

        parser = argparse.ArgumentParser()
        add_native_gguf_arguments(parser)
        return native_gguf_runtime_from_args(parser.parse_args(["--native-gguf-package", "pkg", "--native-gguf-package-id", "a" * 64, *extra]))

    def test_torch_remains_the_default_executor(self) -> None:
        self.assertIsNone(self._parse().llama_cpp)

    def test_llama_cpp_needs_a_build_and_a_view_cache(self) -> None:
        with self.assertRaisesRegex(ValueError, "llama-cpp-build-dir"):
            self._parse("--native-gguf-executor", "llama-cpp", "--llama-cpp-build-dir", "build")
        runtime = self._parse(
            "--native-gguf-executor", "llama-cpp", "--llama-cpp-build-dir", "build",
            "--llama-cpp-view-cache", "views", "--llama-cpp-gpu-layers", "99",
        )
        self.assertEqual(runtime.llama_cpp.gpu_layers, 99)
        self.assertEqual(runtime.llama_cpp.build, "llama.cpp-b12613-win-vulkan-x64")

    def test_rejects_an_unpinned_build(self) -> None:
        with self.assertRaisesRegex(ValueError, "not pinned"):
            self._parse(
                "--native-gguf-executor", "llama-cpp", "--llama-cpp-build-dir", "build",
                "--llama-cpp-view-cache", "views", "--llama-cpp-build", "llama.cpp-unknown",
            )


_BUILD_DIR = os.environ.get("MYCELLIOS_LLAMA_CPP_DIR")
_MODEL = os.environ.get("MYCELLIOS_LLAMA_CPP_MODEL")
_CONFIG = os.environ.get("MYCELLIOS_LLAMA_CPP_CONFIG")


@unittest.skipUnless(_BUILD_DIR and _MODEL and _CONFIG, "pinned llama.cpp build, GGUF model and config are not configured")
class PhysicalTwoStageTests(unittest.TestCase):
    """A two-stage split equals one stage, and waves equal one-token steps."""

    def test_split_and_waves_match_one_stage(self) -> None:
        import torch

        from distributed_runtime.llama_cpp_stage_runner import LlamaCppExecutorConfig
        from distributed_runtime.model import StageModelSpec
        from distributed_runtime.native_gguf_runtime import NativeGgufRuntimeConfig, build_native_gguf_stage_runner

        total = int(json.loads(Path(_CONFIG).read_text(encoding="utf-8"))["num_hidden_layers"])
        cut = total // 2
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = LlamaCppExecutorConfig(
                build_dir=_BUILD_DIR, view_cache=str(root / "views"),
                gpu_layers=int(os.environ.get("MYCELLIOS_LLAMA_CPP_GPU_LAYERS", "0")),
                max_sequences=1, context_tokens=512,
            )
            runners = []
            for start, end in ((0, total), (0, cut), (cut, total)):
                package = build_native_gguf_stage(
                    _MODEL, root / f"stage-{start}-{end}", config_source=_CONFIG,
                    layer_start=start, layer_end=end, total_layers=total,
                    model_source="hf://physical/model", model_revision=None,
                )
                spec = StageModelSpec(
                    model_name="physical", layer_start=start, layer_end=end, total_layers=total, threads=4,
                    artifact_identity=package.artifact_identity, stage_package_identity=package.package_identity,
                    canonical_model_source=package.model_source, canonical_model_revision=package.model_revision,
                )
                runners.append(build_native_gguf_stage_runner(
                    spec, NativeGgufRuntimeConfig(str(package.root), package.package_id, llama_cpp=config),
                ))
            single, head, tail = runners
            try:
                prompt = torch.tensor([[1, 9690, 198, 2683, 359, 253, 5356, 5646, 11173, 3365, 3511, 308]])
                for runner in runners:
                    runner.begin(0)
                _, token = single.forward_ids_with_tokens(0, prompt, token_mode="last")
                reference = [token]
                for _ in range(23):
                    _, token = single.forward_ids_with_tokens(0, torch.tensor([[token]]), token_mode="last")
                    reference.append(token)
                _, token = tail.forward_hidden(0, head.forward_ids(0, prompt), token_mode="last")
                split = [token]
                for _ in range(23):
                    _, token = tail.forward_hidden(0, head.forward_ids(0, torch.tensor([[token]])), token_mode="last")
                    split.append(token)
                self.assertEqual(split, reference)

                for runner in (head, tail):
                    runner.truncate(0, prompt.shape[1])
                waves: list[int] = []
                for start in range(0, 23, 17):
                    chunk = torch.tensor([reference[start:min(start + 17, 23)]])
                    _, tokens = tail.forward_hidden(0, head.forward_ids(0, chunk), token_mode="all")
                    waves.extend(tokens)
                self.assertEqual(waves, reference[1:])
                self.assertEqual(head.sequence_length(0), prompt.shape[1] + 23)
            finally:
                for runner in runners:
                    runner.close()


if __name__ == "__main__":
    unittest.main()
