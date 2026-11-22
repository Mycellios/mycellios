"""Derive a llama.cpp-loadable GGUF from a sealed native GGUF stage package.

A native stage package (``native_gguf.py``) keeps the original block names and
only the tensors its range owns. llama.cpp needs a self-contained model, so
the view written here:

* renames ``blk.N`` to ``blk.(N - layer_start)`` and rewrites the block count;
* adds a copy of the last block to every non-tail stage. llama.cpp exposes the
  residual stream only as the *input* of a block, so the extra block's input is
  the stage output. It is computed and discarded;
* declares no tokenizer (``tokenizer.ggml.model = none``) with the vocabulary
  size the stage needs: the real size for the head and the tail, one for a
  middle stage, whose token embedding is never read;
* supplies the tensors llama.cpp requires but the stage does not use: a unit
  ``output_norm`` for non-tail stages, a one-row token embedding for middle
  stages and, for a tail stage whose model has a separate output matrix, a
  token embedding copied from that matrix (same shape and type).

The view is a cache derived from verified bytes. Its file name binds the
package id and this module's view version, and it is rebuilt when missing.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import struct
import uuid

from .native_gguf import (
    GgufMetadata,
    GgufTensor,
    NativeGgufError,
    NativeGgufStagePackage,
    NATIVE_GGUF_STAGE_WEIGHTS,
    _align,
    _copy_exact,
    _pad_to_alignment,
    _write_metadata_value,
    _write_string,
    parse_gguf,
)

LLAMA_CPP_VIEW_VERSION = 1
_GGML_TYPE_F32 = 0
_GGUF_STRING = 8
_GGUF_UINT32 = 4


@dataclass(frozen=True, slots=True)
class LlamaCppView:
    path: Path
    block_count: int
    output_block: int | None
    vocabulary_size: int

    @property
    def tail(self) -> bool:
        return self.output_block is None


@dataclass(frozen=True, slots=True)
class _Planned:
    name: str
    dimensions: tuple[int, ...]
    ggml_type: int
    size_bytes: int
    source_offset: int | None = None
    payload: bytes | None = None


def llama_cpp_view_path(package: NativeGgufStagePackage, cache_root: str | os.PathLike[str]) -> Path:
    return Path(cache_root) / f"{package.package_id}-v{LLAMA_CPP_VIEW_VERSION}.gguf"


def ensure_llama_cpp_view(package: NativeGgufStagePackage, cache_root: str | os.PathLike[str]) -> LlamaCppView:
    """Return the view for ``package``, writing it atomically when missing."""

    destination = llama_cpp_view_path(package, cache_root)
    source = parse_gguf(package.root / NATIVE_GGUF_STAGE_WEIGHTS)
    if source.file_sha256 != package.stage_gguf_sha256:
        raise NativeGgufError("native GGUF stage weights differ from the sealed package")
    plan, metadata, view = _plan_view(package, source, destination)
    if not destination.is_file():
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        try:
            _write_view(source.path, temporary, metadata, plan, source.alignment, source.version)
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()
    return view


def _plan_view(
    package: NativeGgufStagePackage,
    source,
    destination: Path,
) -> tuple[list[_Planned], list[GgufMetadata], LlamaCppView]:
    architecture = source.architecture
    metadata_map = source.metadata_map()
    hidden = metadata_map.get(f"{architecture}.embedding_length")
    if not isinstance(hidden, int) or hidden < 1:
        raise NativeGgufError("GGUF embedding length is missing")
    head = package.layer_start == 0
    tail = package.layer_end == package.total_layers
    layers = package.layer_end - package.layer_start
    by_name = {tensor.name: tensor for tensor in source.tensors}

    planned: list[_Planned] = []

    def copy(tensor: GgufTensor, name: str | None = None) -> None:
        planned.append(_Planned(
            name=name or tensor.name,
            dimensions=tensor.dimensions,
            ggml_type=tensor.ggml_type,
            size_bytes=tensor.size_bytes,
            source_offset=tensor.data_offset,
        ))

    def synthetic(name: str, dimensions: tuple[int, ...], values: list[float]) -> None:
        payload = struct.pack(f"<{len(values)}f", *values)
        planned.append(_Planned(name, dimensions, _GGML_TYPE_F32, len(payload), payload=payload))

    blocks: dict[int, list[GgufTensor]] = {}
    for tensor in source.tensors:
        if tensor.name.startswith("blk."):
            index = int(tensor.name.split(".", 2)[1])
            if not package.layer_start <= index < package.layer_end:
                raise NativeGgufError("native GGUF stage holds a block outside its range")
            blocks.setdefault(index, []).append(tensor)
    if sorted(blocks) != list(range(package.layer_start, package.layer_end)):
        raise NativeGgufError("native GGUF stage blocks are not contiguous")

    # Token embedding and vocabulary.
    token_embedding = by_name.get("token_embd.weight")
    output = by_name.get("output.weight")
    if head or (tail and token_embedding is not None):
        if token_embedding is None:
            raise NativeGgufError("head stage lacks token_embd.weight")
        copy(token_embedding)
        vocabulary = token_embedding.dimensions[1]
    elif tail:
        if output is None:
            raise NativeGgufError("tail stage lacks both output.weight and token_embd.weight")
        copy(output, "token_embd.weight")
        vocabulary = output.dimensions[1]
    else:
        synthetic("token_embd.weight", (hidden, 1), [0.0] * hidden)
        vocabulary = 1

    for tensor in source.tensors:
        if tensor.name.startswith("rope_freqs."):
            copy(tensor)

    for index in range(package.layer_start, package.layer_end):
        for tensor in blocks[index]:
            suffix = tensor.name.split(".", 2)[2]
            copy(tensor, f"blk.{index - package.layer_start}.{suffix}")
    output_block: int | None = None
    block_count = layers
    if not tail:
        output_block = layers
        for tensor in blocks[package.layer_end - 1]:
            suffix = tensor.name.split(".", 2)[2]
            copy(tensor, f"blk.{layers}.{suffix}")
        block_count = layers + 1
        synthetic("output_norm.weight", (hidden,), [1.0] * hidden)
    else:
        norm = by_name.get("output_norm.weight")
        if norm is None:
            raise NativeGgufError("tail stage lacks output_norm.weight")
        copy(norm)
        if output is not None and token_embedding is not None:
            copy(output)

    metadata = [
        entry for entry in source.metadata
        if entry.key not in (f"{architecture}.block_count", f"{architecture}.vocab_size")
        and not entry.key.startswith("tokenizer.")
    ]
    metadata.extend((
        GgufMetadata(f"{architecture}.block_count", _GGUF_UINT32, block_count),
        GgufMetadata(f"{architecture}.vocab_size", _GGUF_UINT32, vocabulary),
        GgufMetadata("tokenizer.ggml.model", _GGUF_STRING, "none"),
        GgufMetadata("mycellios.llama_cpp_view.version", _GGUF_UINT32, LLAMA_CPP_VIEW_VERSION),
    ))
    view = LlamaCppView(destination, block_count, output_block, vocabulary)
    return planned, metadata, view


def _write_view(
    source_path: Path,
    destination: Path,
    metadata: list[GgufMetadata],
    tensors: list[_Planned],
    alignment: int,
    version: int,
) -> None:
    offsets: list[int] = []
    cursor = 0
    for tensor in tensors:
        cursor = _align(cursor, alignment)
        offsets.append(cursor)
        cursor += tensor.size_bytes
    with destination.open("wb") as output, source_path.open("rb") as source:
        output.write(b"GGUF")
        output.write(struct.pack("<IQQ", version, len(tensors), len(metadata)))
        for entry in metadata:
            _write_string(output, entry.key)
            output.write(struct.pack("<I", entry.value_type))
            _write_metadata_value(output, entry.value_type, entry.value)
        for tensor, offset in zip(tensors, offsets, strict=True):
            _write_string(output, tensor.name)
            output.write(struct.pack("<I", len(tensor.dimensions)))
            for dimension in tensor.dimensions:
                output.write(struct.pack("<Q", dimension))
            output.write(struct.pack("<IQ", tensor.ggml_type, offset))
        _pad_to_alignment(output, alignment)
        data_start = output.tell()
        for tensor, offset in zip(tensors, offsets, strict=True):
            output.write(b"\0" * (data_start + offset - output.tell()))
            if tensor.payload is not None:
                output.write(tensor.payload)
            else:
                source.seek(tensor.source_offset)  # type: ignore[arg-type]
                _copy_exact(source, output, tensor.size_bytes)
        output.flush()
        os.fsync(output.fileno())
