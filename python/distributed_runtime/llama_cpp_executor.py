"""Torch-free child process that executes one llama.cpp stage view.

The stage process starts this file as a script with ``python -I -B``. It never
imports Torch or the ``distributed_runtime`` package (see
``llama_cpp_runtime.py`` for why), and it loads its sibling runtime module by
file path. The parent and the child exchange length-prefixed binary frames on
stdin and stdout; stderr carries llama.cpp's own log.

At startup the child loads the pinned build, loads the view, measures the
micro-batch sizes that are bit-identical to one-position execution, and
reports them in its READY frame. Every later input of at most
``exact_window`` positions is cut into chunks of that size, so a speculative
wave gives the same result as decoding the same positions one at a time.
Longer inputs (prompt prefill) run whole: speculative and plain decoding run
them identically, so they cannot make the two differ.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import struct
import sys
from typing import Any, BinaryIO

import numpy as np

REQUEST_HEADER = struct.Struct("<4sBBqiI")
RESPONSE_HEADER = struct.Struct("<4sBBII")
REQUEST_MAGIC = b"LCQ1"
RESPONSE_MAGIC = b"LCP1"
MAX_PAYLOAD_BYTES = 256 * 1024 * 1024

OP_BEGIN = 1
OP_END = 2
OP_TRUNCATE = 3
OP_TOKENS = 4
OP_HIDDEN = 5
OP_CLOSE = 6

# Output selection for OP_TOKENS / OP_HIDDEN on a tail stage.
MODE_NONE = 0
MODE_LAST = 1
MODE_ALL = 2

KIND_EMPTY = 0
KIND_HIDDEN = 1
KIND_TOKENS = 2
KIND_JSON = 3

STATUS_OK = 0
STATUS_ERROR = 1


def _read_exact(stream: BinaryIO, count: int) -> bytes:
    chunks: list[bytes] = []
    remaining = count
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            raise EOFError("llama.cpp executor stream closed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def write_request(stream: BinaryIO, op: int, request_id: int, *, mode: int = 0, arg: int = 0, payload: bytes = b"") -> None:
    stream.write(REQUEST_HEADER.pack(REQUEST_MAGIC, op, mode, request_id, arg, len(payload)))
    if payload:
        stream.write(payload)
    stream.flush()


def read_request(stream: BinaryIO) -> tuple[int, int, int, int, bytes]:
    magic, op, mode, request_id, arg, length = REQUEST_HEADER.unpack(_read_exact(stream, REQUEST_HEADER.size))
    if magic != REQUEST_MAGIC or length > MAX_PAYLOAD_BYTES:
        raise ValueError("invalid llama.cpp executor request frame")
    return op, mode, request_id, arg, _read_exact(stream, length)


def write_response(stream: BinaryIO, status: int, kind: int, rows: int, payload: bytes) -> None:
    stream.write(RESPONSE_HEADER.pack(RESPONSE_MAGIC, status, kind, rows, len(payload)))
    if payload:
        stream.write(payload)
    stream.flush()


def read_response(stream: BinaryIO) -> tuple[int, int, int, bytes]:
    magic, status, kind, rows, length = RESPONSE_HEADER.unpack(_read_exact(stream, RESPONSE_HEADER.size))
    if magic != RESPONSE_MAGIC or length > MAX_PAYLOAD_BYTES:
        raise ValueError("invalid llama.cpp executor response frame")
    return status, kind, rows, _read_exact(stream, length)


def _write_json(stream: BinaryIO, status: int, value: Any) -> None:
    write_response(stream, status, KIND_JSON, 0, json.dumps(value, sort_keys=True).encode("utf-8"))


def _load_runtime(directory: Path):
    spec = importlib.util.spec_from_file_location("llama_cpp_runtime", directory / "llama_cpp_runtime.py")
    if spec is None or spec.loader is None:
        raise ImportError("llama_cpp_runtime.py is missing")
    module = importlib.util.module_from_spec(spec)
    sys.modules["llama_cpp_runtime"] = module
    spec.loader.exec_module(module)
    return module


class _Executor:
    def __init__(self, runtime, config: dict[str, Any]) -> None:
        self.runtime = runtime
        build = runtime.PINNED_BUILDS[config["build"]]
        library = runtime.LlamaCppLibrary.load(config["build_dir"], build)
        self.head = bool(config["head"])
        self.stage = runtime.LlamaCppStage(
            library,
            config["view"],
            runtime.LlamaCppStageOptions(
                gpu_layers=int(config["gpu_layers"]),
                threads=int(config["threads"]),
                context_tokens=int(config["context_tokens"]) * int(config["max_sequences"]),
                batch_tokens=int(config["batch_tokens"]),
                max_sequences=int(config["max_sequences"]),
                output_layer=config["output_layer"],
            ),
        )
        self.exact_window = int(config["exact_window"])
        self.report = self._self_test(int(config["self_test_positions"]))
        self.max_exact = self.report.max_exact_size

    def info(self) -> dict[str, Any]:
        return {
            "hidden_size": self.stage.hidden_size,
            "layer_count": self.stage.layer_count,
            "vocabulary_size": self.stage.vocabulary_size,
            "tail": self.stage.options.output_layer is None,
            "batch_classes": [list(group) for group in self.report.classes],
            "exact_sizes": list(self.report.exact_sizes),
            "exact_window": self.exact_window,
            "runtime_abi": self.stage.library.build.runtime_abi,
        }

    def _self_test(self, positions: int):
        """Group chunk sizes by identical outputs on this node, before serving."""

        request_id = -1
        rng = np.random.default_rng(20261122)
        prefix_count = 8
        if self.head:
            vocabulary = self.stage.vocabulary_size
            prefix = np.array([(17 + 31 * index) % vocabulary for index in range(prefix_count)], dtype=np.int32)
            sample = np.array([(101 + 7 * index) % vocabulary for index in range(positions)], dtype=np.int32)
        else:
            prefix = rng.standard_normal((prefix_count, self.stage.hidden_size)).astype(np.float32)
            sample = rng.standard_normal((positions, self.stage.hidden_size)).astype(np.float32)
        stage = self.stage
        stage.begin(request_id)
        try:
            self._forward(request_id, prefix, MODE_NONE, chunk=None)
            committed = stage.sequence_length(request_id)

            def reset() -> None:
                stage.truncate(request_id, committed)

            def decode(indices) -> np.ndarray:
                # One call per chunk: the measurement decides the chunk size.
                return self._forward(request_id, sample[list(indices)], MODE_ALL, chunk=None, raw=True)

            sizes = range(1, min(positions, self.exact_window) + 1)
            return self.runtime.measure_batch_classes(decode, reset, list(range(positions)), sizes)
        finally:
            stage.end(request_id)

    def _forward(self, request_id: int, values, mode: int, *, chunk: int | None, raw: bool = False):
        """Run ``values`` (token ids or hidden rows) in chunks of at most ``chunk``."""

        count = len(values)
        sizes = (count,) if chunk is None or count > self.exact_window else self.runtime.plan_micro_batches(count, chunk)
        outputs: list[np.ndarray] = []
        start = 0
        tail = self.stage.options.output_layer is None
        for size in sizes:
            part = values[start:start + size]
            start += size
            rows = "none" if tail and mode == MODE_NONE else "all"
            if self.head:
                result = self.stage.forward_tokens(request_id, part, logits_rows=rows)
            else:
                result = self.stage.forward_hidden(request_id, np.asarray(part, dtype=np.float32), logits_rows=rows)
            if tail:
                if result.logits is not None:
                    outputs.append(result.logits)
            else:
                outputs.append(result.hidden)
        if not outputs:
            return None
        merged = np.concatenate(outputs)
        if raw or not tail:
            return merged
        tokens = merged.argmax(axis=1).astype(np.int32)
        return tokens[-1:] if mode == MODE_LAST else tokens

    def serve(self, source: BinaryIO, sink: BinaryIO) -> None:
        while True:
            op, mode, request_id, arg, payload = read_request(source)
            try:
                if op == OP_CLOSE:
                    _write_json(sink, STATUS_OK, {"closed": True})
                    return
                if op == OP_BEGIN:
                    self.stage.begin(request_id)
                    write_response(sink, STATUS_OK, KIND_EMPTY, 0, b"")
                elif op == OP_END:
                    self.stage.end(request_id)
                    write_response(sink, STATUS_OK, KIND_EMPTY, 0, b"")
                elif op == OP_TRUNCATE:
                    self.stage.truncate(request_id, arg)
                    write_response(sink, STATUS_OK, KIND_EMPTY, 0, b"")
                elif op in (OP_TOKENS, OP_HIDDEN):
                    if op == OP_TOKENS:
                        values = np.frombuffer(payload, dtype=np.int32)
                    else:
                        values = np.frombuffer(payload, dtype=np.float32).reshape(-1, self.stage.hidden_size)
                    output = self._forward(request_id, values, mode, chunk=self.max_exact)
                    if output is None:
                        write_response(sink, STATUS_OK, KIND_EMPTY, 0, b"")
                    elif output.dtype == np.int32:
                        write_response(sink, STATUS_OK, KIND_TOKENS, int(output.shape[0]), output.tobytes())
                    else:
                        data = np.ascontiguousarray(output, dtype=np.float32)
                        write_response(sink, STATUS_OK, KIND_HIDDEN, int(data.shape[0]), data.tobytes())
                else:
                    raise ValueError(f"unknown executor operation {op}")
            except Exception as error:  # reported to the parent, which decides
                _write_json(sink, STATUS_ERROR, {"error": f"{type(error).__name__}: {error}"})


def main() -> int:
    config = json.loads(sys.argv[1])
    source = sys.stdin.buffer
    sink = sys.stdout.buffer
    # llama.cpp logs to stderr; keep stdout for frames only.
    sys.stdout = sys.stderr
    try:
        executor = _Executor(_load_runtime(Path(__file__).resolve().parent), config)
    except Exception as error:
        _write_json(sink, STATUS_ERROR, {"error": f"{type(error).__name__}: {error}"})
        return 1
    _write_json(sink, STATUS_OK, executor.info())
    try:
        executor.serve(source, sink)
    except EOFError:
        pass
    executor.stage.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
