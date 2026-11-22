"""Stage runner that executes a sealed native GGUF package through llama.cpp.

The runner keeps the existing stage contract (BEGIN, forward, TRUNCATE, END)
and delegates execution to ``llama_cpp_executor.py`` in a Torch-free child
process. It verifies the package exactly as the Torch native GGUF runner does,
derives the llama.cpp view (``llama_cpp_view.py``) and converts tensors at the
process boundary.

Not supported, and therefore not advertised: physical speculative trees
(``fork_request``/``promote_request``), activation checkpoints, multi-request
physical batches and sampling logits. The stage and engine already treat those
capabilities as optional and reject configurations that need them.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from typing import Any

import numpy as np
import torch

from . import llama_cpp_executor as protocol
from .executor_abi import build_stage_executor_manifest
from .llama_cpp_runtime import PINNED_BUILDS
from .llama_cpp_view import ensure_llama_cpp_view
from .model import StageModelSpec
from .native_gguf import NativeGgufError, verify_native_gguf_stage

DEFAULT_BUILD = "llama.cpp-b12613-win-vulkan-x64"
# Verification waves are at most MAX_DRAFT_TOKENS + 1 = 17 positions. Longer
# inputs are prompt prefill, which speculative and plain decoding run alike.
EXACT_WINDOW_TOKENS = 17
SELF_TEST_POSITIONS = 17


@dataclass(frozen=True, slots=True)
class LlamaCppExecutorConfig:
    """Node-local settings for executing native GGUF stages with llama.cpp."""

    build_dir: str
    view_cache: str
    build: str = DEFAULT_BUILD
    gpu_layers: int = 0
    max_sequences: int = 4
    context_tokens: int = 4096
    batch_tokens: int = 512

    def __post_init__(self) -> None:
        if not isinstance(self.build_dir, str) or not self.build_dir.strip():
            raise ValueError("llama.cpp build directory cannot be empty")
        if not isinstance(self.view_cache, str) or not self.view_cache.strip():
            raise ValueError("llama.cpp view cache cannot be empty")
        if self.build not in PINNED_BUILDS:
            raise ValueError(f"llama.cpp build {self.build!r} is not pinned")
        for name, minimum in (("gpu_layers", 0), ("max_sequences", 1), ("context_tokens", 1), ("batch_tokens", 1)):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
                raise ValueError(f"llama.cpp {name} is invalid")


class LlamaCppExecutorError(RuntimeError):
    """The llama.cpp child process refused or failed an operation."""


class LlamaCppStageRunner:
    """One native GGUF stage executed by a pinned llama.cpp child process."""

    loader = "native-gdlp-gguf-stage-llama-cpp"

    def __init__(self, spec: StageModelSpec, package_root: str, package_id: str, config: LlamaCppExecutorConfig) -> None:
        package = verify_native_gguf_stage(
            package_root,
            expected_package_id=package_id,
            expected_layer_start=spec.layer_start,
            expected_layer_end=spec.layer_end,
            expected_total_layers=spec.total_layers,
        )
        for field, expected, actual in (
            ("artifact identity", spec.artifact_identity, package.artifact_identity),
            ("package identity", spec.stage_package_identity, package.package_identity),
            ("canonical model source", spec.canonical_model_source, package.model_source),
            ("canonical model revision", spec.canonical_model_revision, package.model_revision),
        ):
            if expected != actual:
                raise NativeGgufError(f"stage {field} differs from the native GGUF package")
        self.spec = spec
        self.config = config
        view = ensure_llama_cpp_view(package, config.view_cache)
        self._lock = threading.Lock()
        self._positions: dict[int, int] = {}
        child_config = {
            "build": config.build,
            "build_dir": config.build_dir,
            "view": str(view.path),
            "head": spec.layer_start == 0,
            "output_layer": view.output_block,
            "gpu_layers": config.gpu_layers,
            "threads": spec.threads,
            "context_tokens": config.context_tokens,
            "batch_tokens": config.batch_tokens,
            "max_sequences": config.max_sequences,
            "exact_window": EXACT_WINDOW_TOKENS,
            "self_test_positions": SELF_TEST_POSITIONS,
        }
        executor = Path(protocol.__file__).resolve()
        self._process = subprocess.Popen(
            [sys.executable, "-I", "-B", str(executor), json.dumps(child_config)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL if os.environ.get("MYCELLIOS_LLAMA_CPP_LOG") != "1" else None,
        )
        status, kind, _rows, payload = self._receive()
        info = json.loads(payload) if kind == protocol.KIND_JSON else {}
        if status != protocol.STATUS_OK:
            self._terminate()
            raise LlamaCppExecutorError(str(info.get("error", "llama.cpp executor failed to start")))
        self.info = info
        self.hidden_size = int(info["hidden_size"])
        self.parameter_bytes = int(view.path.stat().st_size)
        self.tail = bool(info["tail"])
        if self.tail != spec.last:
            self.close()
            raise NativeGgufError("llama.cpp view role differs from the stage range")
        self.executor_manifest = build_stage_executor_manifest(
            engine="llama.cpp",
            engine_version=str(info["runtime_abi"]),
            adapter=f"llama-cpp-{package.architecture}",
            model_identity=package.artifact_identity,
            model_source=package.model_source,
            model_revision=package.model_revision,
            artifact_format="gdlp-layer-gguf",
            layer_start=spec.layer_start,
            layer_end=spec.layer_end,
            total_layers=spec.total_layers,
            hidden_size=self.hidden_size,
            activation_dtype="float32",
            activation_codecs=("fp32", "fp16", "int8", "int8-grouped", "int8-hadamard"),
            max_context_tokens=config.context_tokens,
            device_kinds=("gpu",) if config.gpu_layers > 0 else ("cpu",),
            compute_apis=("llama.cpp",),
            weight_dtypes=("gguf-quantized",),
            features=("layer-range", "rank-local-kv", "rollback"),
        )

    # Lifecycle ------------------------------------------------------------

    def begin(self, request_id: int) -> None:
        with self._lock:
            self._call(protocol.OP_BEGIN, request_id)
            self._positions[request_id] = 0

    def end(self, request_id: int) -> None:
        with self._lock:
            if request_id in self._positions:
                self._call(protocol.OP_END, request_id)
                del self._positions[request_id]

    def sequence_length(self, request_id: int) -> int:
        with self._lock:
            return self._position(request_id)

    def truncate(self, request_id: int, token_count: int) -> None:
        with self._lock:
            self._position(request_id)
            self._call(protocol.OP_TRUNCATE, request_id, arg=int(token_count))
            self._positions[request_id] = int(token_count)

    def close(self) -> None:
        process = getattr(self, "_process", None)
        if process is None or process.poll() is not None:
            return
        try:
            with self._lock:
                protocol.write_request(process.stdin, protocol.OP_CLOSE, 0)
                self._receive()
            process.wait(timeout=10)
        except Exception:
            self._terminate()

    # Execution ------------------------------------------------------------

    def forward_ids(self, request_id: int, input_ids: torch.Tensor) -> torch.Tensor:
        if self.tail:
            raise RuntimeError("forward_ids on a tail stage must project tokens")
        values = self._token_values(input_ids)
        with self._lock:
            output = self._run(protocol.OP_TOKENS, request_id, values.tobytes(), protocol.MODE_ALL, len(values))
        return torch.from_numpy(output).unsqueeze(0)

    def forward_ids_with_tokens(
        self,
        request_id: int,
        input_ids: torch.Tensor,
        *,
        token_mode: str = "last",
    ) -> tuple[torch.Tensor, int | tuple[int, ...]]:
        if not (self.spec.first and self.tail):
            raise RuntimeError("token projection requires one complete local stage")
        mode = self._mode(token_mode, allow_none=False)
        values = self._token_values(input_ids)
        with self._lock:
            tokens = self._run(protocol.OP_TOKENS, request_id, values.tobytes(), mode, len(values))
        placeholder = torch.empty((1, len(values), 0), dtype=torch.float32)
        return placeholder, self._token_result(tokens, mode)

    def forward_hidden(
        self,
        request_id: int,
        hidden: torch.Tensor,
        *,
        token_mode: str = "last",
    ) -> tuple[torch.Tensor, int | tuple[int, ...] | None]:
        if hidden.ndim != 3 or hidden.shape[0] != 1 or hidden.shape[2] != self.hidden_size:
            raise ValueError(f"hidden state must have shape [1, tokens, {self.hidden_size}]")
        if not hidden.is_floating_point():
            raise TypeError("hidden state must be floating point")
        rows = np.ascontiguousarray(hidden[0].detach().to(device="cpu", dtype=torch.float32).numpy())
        count = int(rows.shape[0])
        if not self.tail:
            with self._lock:
                output = self._run(protocol.OP_HIDDEN, request_id, rows.tobytes(), protocol.MODE_ALL, count)
            return torch.from_numpy(output).unsqueeze(0), None
        mode = self._mode(token_mode, allow_none=True)
        with self._lock:
            tokens = self._run(protocol.OP_HIDDEN, request_id, rows.tobytes(), mode, count)
        return hidden, None if mode == protocol.MODE_NONE else self._token_result(tokens, mode)

    def execution_snapshot(self) -> dict[str, Any]:
        return {
            "backend": "llama.cpp",
            "runtimeAbi": self.info.get("runtime_abi"),
            "gpuLayers": self.config.gpu_layers,
            "exactMicroBatchSizes": list(self.info.get("exact_sizes", [])),
            "batchClasses": list(self.info.get("batch_classes", [])),
        }

    # Internals ------------------------------------------------------------

    @staticmethod
    def _mode(token_mode: str, *, allow_none: bool) -> int:
        modes = {"last": protocol.MODE_LAST, "all": protocol.MODE_ALL}
        if allow_none:
            modes["none"] = protocol.MODE_NONE
        if token_mode not in modes:
            raise ValueError(f"unsupported token_mode {token_mode!r}")
        return modes[token_mode]

    @staticmethod
    def _token_values(input_ids: torch.Tensor) -> np.ndarray:
        if input_ids.ndim != 2 or input_ids.shape[0] != 1 or input_ids.shape[1] < 1:
            raise ValueError("input_ids must have shape [1, tokens] with at least one token")
        if input_ids.dtype not in (torch.int32, torch.int64):
            raise TypeError("input_ids must contain integer token IDs")
        return np.ascontiguousarray(input_ids[0].to(device="cpu").numpy().astype(np.int32))

    @staticmethod
    def _token_result(tokens: np.ndarray | None, mode: int) -> int | tuple[int, ...]:
        if tokens is None or tokens.size < 1:
            raise LlamaCppExecutorError("llama.cpp executor returned no tokens")
        if mode == protocol.MODE_LAST:
            return int(tokens[-1])
        return tuple(int(token) for token in tokens)

    def _position(self, request_id: int) -> int:
        position = self._positions.get(request_id)
        if position is None:
            raise ValueError(f"request {request_id} has not received BEGIN")
        return position

    def _run(self, op: int, request_id: int, payload: bytes, mode: int, count: int) -> np.ndarray | None:
        position = self._position(request_id)
        kind, rows, data = self._call(op, request_id, payload=payload, mode=mode)
        self._positions[request_id] = position + count
        if kind == protocol.KIND_EMPTY:
            return None
        if kind == protocol.KIND_TOKENS:
            return np.frombuffer(data, dtype=np.int32).copy()
        if kind == protocol.KIND_HIDDEN:
            return np.frombuffer(data, dtype=np.float32).reshape(rows, self.hidden_size).copy()
        raise LlamaCppExecutorError("llama.cpp executor returned an unexpected payload")

    def _call(self, op: int, request_id: int, *, payload: bytes = b"", mode: int = 0, arg: int = 0) -> tuple[int, int, bytes]:
        process = self._process
        if process.poll() is not None:
            raise LlamaCppExecutorError(f"llama.cpp executor exited with code {process.returncode}")
        try:
            protocol.write_request(process.stdin, op, request_id, mode=mode, arg=arg, payload=payload)
            status, kind, rows, data = self._receive()
        except (EOFError, OSError) as error:
            raise LlamaCppExecutorError("llama.cpp executor stopped responding") from error
        if status != protocol.STATUS_OK:
            message = json.loads(data).get("error", "unknown error") if kind == protocol.KIND_JSON else "unknown error"
            raise LlamaCppExecutorError(f"llama.cpp executor failed: {message}")
        return kind, rows, data

    def _receive(self) -> tuple[int, int, int, bytes]:
        return protocol.read_response(self._process.stdout)

    def _terminate(self) -> None:
        process = getattr(self, "_process", None)
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=10)
