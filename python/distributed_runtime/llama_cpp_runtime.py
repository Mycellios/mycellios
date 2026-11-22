"""Pinned llama.cpp execution for quantized layer-range stages.

This module drives an unpatched, official llama.cpp release build through its
C API (``specs/native-quantized-stages/spec.md``). It owns three things:

* pin verification: a build directory is used only when every library it can
  load matches a pinned SHA-256, and it contains no other loadable library;
* a stage over one GGUF layer-range package, with one llama.cpp sequence per
  request, token or hidden-state input, hidden-state or logit output and
  exact KV truncation;
* the batch-class self-test, which finds the micro-batch sizes whose results
  are bit-identical to one-token decoding on this node.

The module imports only the standard library and numpy, and it must run in a
process that never imports Torch: on Windows, Torch's Intel OpenMP and
llama.cpp's LLVM OpenMP cannot both initialize in one process. Load it by file
path, because importing the ``distributed_runtime`` package imports Torch.

The struct layouts below are those of the pinned build. They are only valid
because the library files are hash-checked before loading; another build may
lay them out differently. Hash checks protect against corrupt or mismatched
files, not against a node owner who controls the machine.
"""

from __future__ import annotations

import ctypes as C
from dataclasses import dataclass, field
import hashlib
import os
from pathlib import Path
from typing import Callable, Mapping, Sequence

import numpy as np


_LOADABLE_SUFFIXES = (".dll", ".so", ".dylib")


@dataclass(frozen=True, slots=True)
class PinnedLlamaCppBuild:
    """One official llama.cpp release artifact and the libraries it loads."""

    build: str
    target: str
    archive_sha256: str
    archive_url: str
    archive_size: int
    libraries: Mapping[str, str]
    library_name: str
    ggml_name: str

    @property
    def runtime_abi(self) -> str:
        return f"llama.cpp-{self.build}-{self.target}"


PINNED_BUILDS: Mapping[str, PinnedLlamaCppBuild] = {
    "llama.cpp-b12613-win-vulkan-x64": PinnedLlamaCppBuild(
        build="b12613",
        target="win-vulkan-x64",
        archive_sha256="56f1fca056efc933a39226fa767328a0082ebd42ec3c4d2e0193a37ac44abdee",
        archive_url="https://github.com/ggml-org/llama.cpp/releases/download/b12613/llama-b12613-bin-win-vulkan-x64.zip",
        archive_size=38_845_965,
        library_name="llama.dll",
        ggml_name="ggml.dll",
        libraries={
            "llama.dll": "35f1d358a0f49183784da50940ad807053734bebce0117151b322b2cc8c6fb04",
            "ggml.dll": "4d2a625ae0323bb9f24bcbb8e0b31c5d457ea7ae633012ae3926abfc8971f063",
            "ggml-base.dll": "f2d0fe2dc43e287476e1d7afa6c51cb42eca86c1df2615137d197157facf6afd",
            "ggml-vulkan.dll": "870b5eb50f5c8138dbad49f0ede9f46807b1ae5a937c0fc1297a2b71530f6643",
            "ggml-cpu-alderlake.dll": "4ebd02d1e62c05143912f6a627cbdc76ae7ef5643814f037f89c6466e1ba02d0",
            "ggml-cpu-cannonlake.dll": "3cac5855c8f20d3734ce6441fe1fab77967d8fef139489310b2909bac408d450",
            "ggml-cpu-cascadelake.dll": "ae6b226745aa9b34bd8dcfaeeb59a3670d3df233899ac7833382957f5a0be9c3",
            "ggml-cpu-cooperlake.dll": "cee3ed89cff3c5a273a6e1b88f85c9f9ebe83acf2b2c2a713351ad5c1e824a58",
            "ggml-cpu-haswell.dll": "fb29d28addc5a4615b7d39c58c657fc3be56fa0f188a06d63b297d072d1c14f1",
            "ggml-cpu-icelake.dll": "e279c0b33370451e773d8d4182505b97cad6faeaa10530636802034fb6b17370",
            "ggml-cpu-ivybridge.dll": "eb238c21f4d5d6c2c6267ed1eba44ab63a666902156ed1506a1c19601ba69c11",
            "ggml-cpu-piledriver.dll": "dc9229bc06e05ae15ce4464d59f091657328777026b2f8243b5c378cc0c88c8b",
            "ggml-cpu-sandybridge.dll": "fab7a83a1c5bf6dff43522d09205fc34b2ce7efff343da580087a48684dafa48",
            "ggml-cpu-sapphirerapids.dll": "3340e7c2da586cc1e9e0794e90a0fc69d2b58175028e9d76dd9eb6ff1bc6b17e",
            "ggml-cpu-skylakex.dll": "3918bb7887afe6fab9d1223310e7723e2403cea772c5c0cb987ce002b5b2f515",
            "ggml-cpu-sse42.dll": "7682017b8dcc59d0f19ab4723c8122d5c65a4d11d7b0cc78c60b5453203f03ca",
            "ggml-cpu-x64.dll": "606b8fbe25c97279ac879e9e7bd76453a2b6f36409432bdd2771478f3a4b60ef",
            "ggml-cpu-zen4.dll": "ade9f26dccbc22ae6a26fa3212e0a465f0f66b48cccd411f4222d7a018ccb5f5",
            "libomp.dll": "1e4222f195d84e7355109d778e751dfe3c085e42c947f7fe3d7853181329dd40",
        },
    ),
}


class LlamaCppRuntimeError(RuntimeError):
    """The pinned runtime cannot be used on this node."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_build_directory(directory: str | os.PathLike[str], build: PinnedLlamaCppBuild) -> Path:
    """Return the directory only if it holds exactly the pinned loadable libraries.

    Every pinned library must be present with its pinned hash. Any other
    loadable library is rejected, because the backend loader and the operating
    system can both pick up a library that merely sits in the same directory.
    """

    root = Path(directory)
    if not root.is_dir():
        raise LlamaCppRuntimeError("llama_cpp_build_directory_is_missing")
    present = {
        entry.name: entry
        for entry in root.iterdir()
        if entry.is_file() and entry.name.lower().endswith(_LOADABLE_SUFFIXES)
    }
    unexpected = sorted(set(present) - set(build.libraries))
    if unexpected:
        raise LlamaCppRuntimeError(f"llama_cpp_build_has_unpinned_library:{unexpected[0]}")
    for name, expected in sorted(build.libraries.items()):
        entry = present.get(name)
        if entry is None:
            raise LlamaCppRuntimeError(f"llama_cpp_build_library_is_missing:{name}")
        if _sha256_file(entry) != expected:
            raise LlamaCppRuntimeError(f"llama_cpp_build_library_hash_mismatch:{name}")
    return root


# --- Struct layouts of the pinned build (llama.h at b12613) -----------------


class _ModelParams(C.Structure):
    _fields_ = [
        ("devices", C.c_void_p), ("tensor_buft_overrides", C.c_void_p),
        ("n_gpu_layers", C.c_int32), ("split_mode", C.c_int), ("load_mode", C.c_int),
        ("lazy_mode", C.c_int), ("main_gpu", C.c_int32), ("tensor_split", C.c_void_p),
        ("progress_callback", C.c_void_p), ("progress_callback_user_data", C.c_void_p),
        ("kv_overrides", C.c_void_p),
        ("vocab_only", C.c_bool), ("check_tensors", C.c_bool), ("use_extra_bufts", C.c_bool),
        ("no_host", C.c_bool), ("no_alloc", C.c_bool), ("load_mtp", C.c_bool),
    ]


class _ContextParams(C.Structure):
    _fields_ = [
        ("n_ctx", C.c_uint32), ("n_batch", C.c_uint32), ("n_ubatch", C.c_uint32),
        ("n_seq_max", C.c_uint32), ("n_rs_seq", C.c_uint32), ("n_outputs_max", C.c_uint32),
        ("n_outputs_max_per_seq", C.c_uint32), ("n_threads", C.c_int32), ("n_threads_batch", C.c_int32),
        ("ctx_type", C.c_int), ("rope_scaling_type", C.c_int), ("pooling_type", C.c_int),
        ("attention_type", C.c_int), ("flash_attn_type", C.c_int),
        ("rope_freq_base", C.c_float), ("rope_freq_scale", C.c_float), ("yarn_ext_factor", C.c_float),
        ("yarn_attn_factor", C.c_float), ("yarn_beta_fast", C.c_float), ("yarn_beta_slow", C.c_float),
        ("yarn_orig_ctx", C.c_uint32), ("cb_eval", C.c_void_p), ("cb_eval_user_data", C.c_void_p),
        ("type_k", C.c_int), ("type_v", C.c_int),
        ("moe_cache_size", C.c_size_t), ("moe_cache_cpu_share", C.c_float),
        ("abort_callback", C.c_void_p), ("abort_callback_data", C.c_void_p),
        ("embeddings", C.c_bool), ("offload_kqv", C.c_bool), ("no_perf", C.c_bool),
        ("op_offload", C.c_bool), ("swa_full", C.c_bool), ("kv_unified", C.c_bool),
        ("samplers", C.c_void_p), ("n_samplers", C.c_size_t), ("ctx_other", C.c_void_p),
    ]


class _Batch(C.Structure):
    _fields_ = [
        ("n_tokens", C.c_int32), ("token", C.POINTER(C.c_int32)), ("embd", C.POINTER(C.c_float)),
        ("pos", C.POINTER(C.c_int32)), ("n_seq_id", C.POINTER(C.c_int32)),
        ("seq_id", C.POINTER(C.POINTER(C.c_int32))), ("logits", C.POINTER(C.c_int8)),
    ]


_FLOAT_POINTER = C.POINTER(C.c_float)
_SIGNATURES: Mapping[str, tuple[object, list[object]]] = {
    "llama_model_default_params": (_ModelParams, []),
    "llama_context_default_params": (_ContextParams, []),
    "llama_model_load_from_file": (C.c_void_p, [C.c_char_p, _ModelParams]),
    "llama_init_from_model": (C.c_void_p, [C.c_void_p, _ContextParams]),
    "llama_decode": (C.c_int32, [C.c_void_p, _Batch]),
    "llama_get_logits_ith": (_FLOAT_POINTER, [C.c_void_p, C.c_int32]),
    "llama_set_embeddings_layer_inp": (None, [C.c_void_p, C.c_uint32, C.c_bool]),
    "llama_get_embeddings_layer_inp": (_FLOAT_POINTER, [C.c_void_p, C.c_uint32]),
    "llama_get_memory": (C.c_void_p, [C.c_void_p]),
    "llama_memory_seq_rm": (C.c_bool, [C.c_void_p, C.c_int32, C.c_int32, C.c_int32]),
    "llama_model_n_embd": (C.c_int32, [C.c_void_p]),
    "llama_model_n_layer": (C.c_int32, [C.c_void_p]),
    "llama_model_get_vocab": (C.c_void_p, [C.c_void_p]),
    "llama_vocab_n_tokens": (C.c_int32, [C.c_void_p]),
    "llama_free": (None, [C.c_void_p]),
    "llama_model_free": (None, [C.c_void_p]),
    "llama_backend_init": (None, []),
}


class LlamaCppLibrary:
    """The pinned shared library, loaded once per process after verification."""

    _loaded: dict[str, "LlamaCppLibrary"] = {}

    def __init__(self, directory: Path, build: PinnedLlamaCppBuild) -> None:
        self.directory = directory
        self.build = build
        if hasattr(os, "add_dll_directory"):
            self._dll_directory = os.add_dll_directory(str(directory))
        ggml = C.CDLL(str(directory / build.ggml_name))
        library = C.CDLL(str(directory / build.library_name))
        for name, (restype, argtypes) in _SIGNATURES.items():
            function = getattr(library, name)
            function.restype = restype
            function.argtypes = argtypes
        # The directory holds only pinned libraries, so loading every backend
        # it contains lets ggml pick the best CPU variant for this processor.
        ggml.ggml_backend_load_all_from_path.argtypes = [C.c_char_p]
        ggml.ggml_backend_load_all_from_path.restype = None
        ggml.ggml_backend_load_all_from_path(str(directory).encode("utf-8"))
        library.llama_backend_init()
        self.ggml = ggml
        self.api = library
        self.gpu_devices = _gpu_devices(directory, build, ggml)

    @property
    def offload_backend(self) -> str:
        """The backend offloaded blocks run on: the first GPU's, or the CPU."""

        return self.gpu_devices[0][0] if self.gpu_devices else "cpu"

    @classmethod
    def load(cls, directory: str | os.PathLike[str], build: PinnedLlamaCppBuild) -> "LlamaCppLibrary":
        root = verify_build_directory(directory, build).resolve()
        loaded = next(iter(cls._loaded.values()), None)
        if loaded is not None:
            if loaded.build != build or loaded.directory != root:
                raise LlamaCppRuntimeError("llama_cpp_process_already_loaded_another_build")
            return loaded
        library = cls(root, build)
        cls._loaded[build.runtime_abi] = library
        return library


_GGML_DEVICE_GPU_TYPES = (1, 2)  # GGML_BACKEND_DEVICE_TYPE_GPU, _IGPU (integrated)


def _gpu_devices(directory: Path, build: PinnedLlamaCppBuild, ggml: C.CDLL) -> tuple[tuple[str, str], ...]:
    """(backend, description) of every GPU the loaded ggml backends found.

    ggml lists the devices of every backend it loaded from the pinned
    directory; a node without a usable Vulkan driver simply lists none.
    """

    base = C.CDLL(str(directory / build.ggml_name.replace("ggml", "ggml-base", 1)))
    ggml.ggml_backend_dev_count.restype = C.c_size_t
    ggml.ggml_backend_dev_get.restype = C.c_void_p
    ggml.ggml_backend_dev_get.argtypes = [C.c_size_t]
    for name, restype in (
        ("ggml_backend_dev_type", C.c_int),
        ("ggml_backend_dev_description", C.c_char_p),
        ("ggml_backend_dev_backend_reg", C.c_void_p),
    ):
        getattr(base, name).restype = restype
        getattr(base, name).argtypes = [C.c_void_p]
    base.ggml_backend_reg_name.restype = C.c_char_p
    base.ggml_backend_reg_name.argtypes = [C.c_void_p]
    devices = []
    for index in range(ggml.ggml_backend_dev_count()):
        device = ggml.ggml_backend_dev_get(index)
        if base.ggml_backend_dev_type(device) not in _GGML_DEVICE_GPU_TYPES:
            continue
        backend = (base.ggml_backend_reg_name(base.ggml_backend_dev_backend_reg(device)) or b"").decode("utf-8", "replace")
        description = (base.ggml_backend_dev_description(device) or b"").decode("utf-8", "replace").strip()
        devices.append((backend.lower(), description))
    return tuple(devices)


# --- Stage over one layer-range package -------------------------------------


@dataclass(slots=True)
class _Sequence:
    seq_id: int
    position: int = 0


@dataclass(frozen=True, slots=True)
class LlamaCppStageOptions:
    gpu_layers: int = 0
    threads: int = 4
    context_tokens: int = 4096
    batch_tokens: int = 512
    max_sequences: int = 1
    output_layer: int | None = None

    def __post_init__(self) -> None:
        for name in ("threads", "context_tokens", "batch_tokens", "max_sequences"):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise ValueError(f"{name} must be a positive integer")
        if not isinstance(self.gpu_layers, int) or isinstance(self.gpu_layers, bool) or self.gpu_layers < 0:
            raise ValueError("gpu_layers must be a non-negative integer")
        if self.output_layer is not None and (
            not isinstance(self.output_layer, int) or isinstance(self.output_layer, bool) or self.output_layer < 0
        ):
            raise ValueError("output_layer must be a non-negative integer or None")


@dataclass(frozen=True, slots=True)
class StageOutput:
    """Hidden states for a non-tail stage, or logits rows for the tail."""

    hidden: np.ndarray | None
    logits: np.ndarray | None


class LlamaCppStage:
    """One GGUF layer-range package with one llama.cpp sequence per request.

    ``output_layer`` names the block whose input is returned as the stage's
    hidden state. It is ``None`` for the tail stage, which returns logits.
    """

    def __init__(self, library: LlamaCppLibrary, package: str | os.PathLike[str], options: LlamaCppStageOptions) -> None:
        self.library = library
        self.options = options
        api = library.api
        model_params = api.llama_model_default_params()
        model_params.n_gpu_layers = options.gpu_layers
        self._model = api.llama_model_load_from_file(str(Path(package)).encode("utf-8"), model_params)
        if not self._model:
            raise LlamaCppRuntimeError("llama_cpp_model_failed_to_load")
        context_params = api.llama_context_default_params()
        context_params.n_ctx = options.context_tokens
        context_params.n_batch = options.batch_tokens
        context_params.n_ubatch = options.batch_tokens
        context_params.n_seq_max = options.max_sequences
        context_params.n_threads = options.threads
        context_params.n_threads_batch = options.threads
        context_params.no_perf = True
        self._context = api.llama_init_from_model(self._model, context_params)
        if not self._context:
            api.llama_model_free(self._model)
            raise LlamaCppRuntimeError("llama_cpp_context_failed_to_initialize")
        self.hidden_size = int(api.llama_model_n_embd(self._model))
        self.layer_count = int(api.llama_model_n_layer(self._model))
        self.vocabulary_size = int(api.llama_vocab_n_tokens(api.llama_model_get_vocab(self._model)))
        if options.output_layer is not None:
            if options.output_layer >= self.layer_count:
                self.close()
                raise LlamaCppRuntimeError("llama_cpp_output_layer_is_outside_package")
            api.llama_set_embeddings_layer_inp(self._context, options.output_layer, True)
        self._memory = api.llama_get_memory(self._context)
        self._sequences: dict[int, _Sequence] = {}
        self._closed = False

    # Request lifecycle ------------------------------------------------------

    def begin(self, request_id: int) -> None:
        if request_id in self._sequences:
            raise ValueError(f"request {request_id} already began")
        used = {sequence.seq_id for sequence in self._sequences.values()}
        free = next((seq for seq in range(self.options.max_sequences) if seq not in used), None)
        if free is None:
            raise LlamaCppRuntimeError("llama_cpp_sequence_capacity_exhausted")
        self._remove(free, 0)
        self._sequences[request_id] = _Sequence(free)

    def end(self, request_id: int) -> None:
        sequence = self._sequences.pop(request_id, None)
        if sequence is not None:
            self._remove(sequence.seq_id, 0)

    def sequence_length(self, request_id: int) -> int:
        return self._sequence(request_id).position

    def truncate(self, request_id: int, token_count: int) -> None:
        sequence = self._sequence(request_id)
        if not isinstance(token_count, int) or token_count < 0 or token_count > sequence.position:
            raise ValueError("token_count must be within the committed sequence")
        self._remove(sequence.seq_id, token_count)
        sequence.position = token_count

    # Execution --------------------------------------------------------------

    def forward_tokens(self, request_id: int, tokens: Sequence[int], *, logits_rows: str = "all") -> StageOutput:
        values = np.ascontiguousarray(np.asarray(tokens, dtype=np.int32).reshape(-1))
        if values.size < 1:
            raise ValueError("at least one token is required")
        if np.any(values < 0) or np.any(values >= self.vocabulary_size):
            raise ValueError("token id is outside the vocabulary")
        return self._forward(request_id, int(values.size), tokens=values, logits_rows=logits_rows)

    def forward_hidden(self, request_id: int, hidden: np.ndarray, *, logits_rows: str = "all") -> StageOutput:
        values = np.ascontiguousarray(np.asarray(hidden, dtype=np.float32))
        if values.ndim != 2 or values.shape[0] < 1 or values.shape[1] != self.hidden_size:
            raise ValueError(f"hidden state must have shape [tokens, {self.hidden_size}]")
        if not np.all(np.isfinite(values)):
            raise ValueError("hidden state must be finite")
        return self._forward(request_id, int(values.shape[0]), hidden=values, logits_rows=logits_rows)

    def close(self) -> None:
        if getattr(self, "_closed", True):
            return
        self._closed = True
        self.library.api.llama_free(self._context)
        self.library.api.llama_model_free(self._model)

    # Internals --------------------------------------------------------------

    def _sequence(self, request_id: int) -> _Sequence:
        sequence = self._sequences.get(request_id)
        if sequence is None:
            raise ValueError(f"request {request_id} has not received BEGIN")
        return sequence

    def _remove(self, seq_id: int, start: int) -> None:
        if not self.library.api.llama_memory_seq_rm(self._memory, seq_id, start, -1):
            raise LlamaCppRuntimeError("llama_cpp_kv_truncate_failed")

    def _forward(
        self,
        request_id: int,
        count: int,
        *,
        tokens: np.ndarray | None = None,
        hidden: np.ndarray | None = None,
        logits_rows: str,
    ) -> StageOutput:
        if logits_rows not in ("all", "last", "none"):
            raise ValueError("logits_rows must be all, last or none")
        if count > self.options.batch_tokens:
            raise ValueError("input exceeds the stage batch capacity")
        sequence = self._sequence(request_id)
        if sequence.position + count > self.options.context_tokens:
            raise LlamaCppRuntimeError("llama_cpp_context_is_exhausted")
        is_tail = self.options.output_layer is None
        positions = np.arange(sequence.position, sequence.position + count, dtype=np.int32)
        seq_counts = np.ones(count, dtype=np.int32)
        seq_value = (C.c_int32 * 1)(sequence.seq_id)
        seq_pointers = (C.POINTER(C.c_int32) * count)(*([C.cast(seq_value, C.POINTER(C.c_int32))] * count))
        outputs = np.zeros(count, dtype=np.int8)
        if not is_tail or logits_rows == "all":
            outputs[:] = 1
        elif logits_rows == "last":
            outputs[-1] = 1
        batch = _Batch()
        batch.n_tokens = count
        batch.pos = positions.ctypes.data_as(C.POINTER(C.c_int32))
        batch.n_seq_id = seq_counts.ctypes.data_as(C.POINTER(C.c_int32))
        batch.seq_id = seq_pointers
        batch.logits = outputs.ctypes.data_as(C.POINTER(C.c_int8))
        if tokens is not None:
            batch.token = tokens.ctypes.data_as(C.POINTER(C.c_int32))
        else:
            batch.embd = hidden.ctypes.data_as(C.POINTER(C.c_float))  # type: ignore[union-attr]
        status = int(self.library.api.llama_decode(self._context, batch))
        if status != 0:
            # A failed decode may leave part of the batch in the KV cache.
            self._remove(sequence.seq_id, sequence.position)
            raise LlamaCppRuntimeError(f"llama_cpp_decode_failed:{status}")
        sequence.position += count
        if not is_tail:
            pointer = self.library.api.llama_get_embeddings_layer_inp(self._context, self.options.output_layer)
            states = np.ctypeslib.as_array(pointer, shape=(count, self.hidden_size)).copy()
            return StageOutput(hidden=states, logits=None)
        if logits_rows == "none":
            return StageOutput(hidden=None, logits=None)
        rows = range(count) if logits_rows == "all" else (count - 1,)
        logits = np.stack([
            np.ctypeslib.as_array(
                self.library.api.llama_get_logits_ith(self._context, index),
                shape=(self.vocabulary_size,),
            ).copy()
            for index in rows
        ])
        return StageOutput(hidden=None, logits=logits)


# --- Batch-class self-test ---------------------------------------------------


@dataclass(frozen=True, slots=True)
class BatchClassReport:
    """Micro-batch sizes grouped by bit-identical results on this node."""

    classes: tuple[tuple[int, ...], ...]
    exact_sizes: tuple[int, ...] = field(default=())

    @property
    def max_exact_size(self) -> int:
        return max(self.exact_sizes, default=0)


def group_batch_classes(results: Mapping[int, np.ndarray]) -> tuple[tuple[int, ...], ...]:
    """Group sizes whose result arrays are bit-identical, in ascending size order."""

    classes: list[list[int]] = []
    for size in sorted(results):
        for group in classes:
            if np.array_equal(results[group[0]], results[size]):
                group.append(size)
                break
        else:
            classes.append([size])
    return tuple(tuple(group) for group in classes)


def batch_class_report(results: Mapping[int, np.ndarray]) -> BatchClassReport:
    """Exact sizes are those that agree with one-token decoding.

    Speculation verifies drafts in waves, while ordinary decoding runs one
    token at a time. Only sizes in the same class as size 1 make a wave give
    the same tokens as decoding would; without size 1 no size is exact.
    """

    if 1 not in results:
        raise ValueError("the self-test must include one-token decoding")
    classes = group_batch_classes(results)
    exact = next(group for group in classes if 1 in group)
    return BatchClassReport(classes=classes, exact_sizes=exact)


def plan_micro_batches(count: int, max_size: int) -> tuple[int, ...]:
    """Cut ``count`` positions into the fewest chunks of at most ``max_size``.

    Every exact class measured so far is contiguous from 1, so any chunk size
    up to the largest exact size is itself exact.
    """

    if not isinstance(count, int) or count < 1:
        raise ValueError("count must be a positive integer")
    if not isinstance(max_size, int) or max_size < 1:
        raise ValueError("max_size must be a positive integer")
    full, rest = divmod(count, max_size)
    return (max_size,) * full + ((rest,) if rest else ())


def measure_batch_classes(
    decode: Callable[[Sequence[int]], np.ndarray],
    reset: Callable[[], None],
    tokens: Sequence[int],
    sizes: Sequence[int],
) -> BatchClassReport:
    """Decode the same ``tokens`` once per chunk size and compare the logits.

    ``decode`` appends a chunk and returns its logits rows; ``reset`` restores
    the state before ``tokens``. When a size does not divide the token count,
    the final chunk is shorter, as in real waves.
    """

    if not tokens:
        raise ValueError("the self-test needs at least one token")
    results: dict[int, np.ndarray] = {}
    for size in sorted(set(sizes) | {1}):
        reset()
        rows: list[np.ndarray] = []
        for start in range(0, len(tokens), size):
            rows.append(np.asarray(decode(tokens[start:start + size])))
        results[size] = np.concatenate(rows)
    return batch_class_report(results)


def measure_stage_batch_classes(
    stage: LlamaCppStage,
    prompt: Sequence[int],
    continuation: Sequence[int],
    sizes: Sequence[int],
    *,
    request_id: int = -1,
) -> BatchClassReport:
    """Run :func:`measure_batch_classes` on a tail stage with one scratch request."""

    if stage.options.output_layer is not None:
        raise ValueError("the batch-class self-test runs on a stage that returns logits")
    stage.begin(request_id)
    try:
        stage.forward_tokens(request_id, prompt, logits_rows="none")
        committed = stage.sequence_length(request_id)

        def reset() -> None:
            stage.truncate(request_id, committed)

        def decode(chunk: Sequence[int]) -> np.ndarray:
            output = stage.forward_tokens(request_id, chunk, logits_rows="all")
            assert output.logits is not None
            return output.logits

        return measure_batch_classes(decode, reset, continuation, sizes)
    finally:
        stage.end(request_id)
