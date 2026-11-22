"""Build a native GGUF stage package from a remote GGUF, fetching only its tensors.

A requested model's GGUF can be many gigabytes, and each node needs only the
blocks of its stage. The coordinator publishes a *tensor manifest*, computed
once from the complete file: the artifact's SHA-256 and size, the SHA-256 of
its header and the offset, size and SHA-256 of every tensor. It also carries
the Hugging Face ``config.json`` the package seals.

A node then:

1. fetches the header with one HTTP range request and checks its hash;
2. parses it against the declared artifact size and checks that every tensor
   matches the manifest;
3. fetches only the tensors its stage needs, each checked against its hash;
4. builds the package with ``build_native_gguf_stage``.

The result is byte-identical to a package built from the complete file: same
tensors, same metadata, same source identity. Nothing unverified reaches the
package, so a mirror or cache can serve the bytes without being trusted.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
from typing import Any, Callable, Mapping, Sequence
import urllib.error
import urllib.request
import uuid

from .native_gguf import (
    GgufDocument,
    NativeGgufError,
    NativeGgufStagePackage,
    _canonical_json,
    _select_stage_tensors,
    build_native_gguf_stage,
    parse_gguf,
    parse_gguf_header,
    verify_native_gguf_stage,
)

TENSOR_MANIFEST_SCHEMA = "gdlp-gguf-tensor-manifest/1"
MAX_HEADER_BYTES = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024 * 1024
_FETCH_CHUNK = 8 * 1024 * 1024

RangeFetcher = Callable[[int, int], bytes]
"""Return exactly ``length`` bytes starting at ``offset`` of the artifact."""


class TensorManifestError(NativeGgufError):
    """The remote artifact does not match its published tensor manifest."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_tensor_manifest(
    source_gguf: str | os.PathLike[str],
    config_source: str | os.PathLike[str],
) -> dict[str, Any]:
    """Describe a complete GGUF so nodes can fetch and verify any tensor alone."""

    document = parse_gguf(source_gguf)
    config_path = Path(config_source)
    if config_path.is_dir():
        config_path = config_path / "config.json"
    # The package seals the config file's exact bytes, so the manifest keeps
    # its original text rather than a re-serialized object.
    config_text = config_path.read_bytes().decode("utf-8")
    if not isinstance(json.loads(config_text), dict):
        raise TensorManifestError("model config must be a JSON object")
    with document.path.open("rb") as handle:
        header = handle.read(document.data_offset)
        tensors = []
        for tensor in sorted(document.tensors, key=lambda item: item.data_offset):
            handle.seek(tensor.data_offset)
            digest = hashlib.sha256()
            remaining = tensor.size_bytes
            while remaining:
                block = handle.read(min(_FETCH_CHUNK, remaining))
                if not block:
                    raise TensorManifestError(f"tensor {tensor.name!r} is truncated")
                digest.update(block)
                remaining -= len(block)
            tensors.append({
                "name": tensor.name,
                "offset": tensor.data_offset,
                "sizeBytes": tensor.size_bytes,
                "sha256": digest.hexdigest(),
            })
    without_id = {
        "schema": TENSOR_MANIFEST_SCHEMA,
        "source": {"sha256": document.file_sha256, "sizeBytes": document.path.stat().st_size},
        "header": {"sizeBytes": document.data_offset, "sha256": _sha256(header)},
        "architecture": document.architecture,
        "configText": config_text,
        "tensors": tensors,
    }
    return {**without_id, "manifestId": _sha256(_canonical_json(without_id))}


@dataclass(frozen=True, slots=True)
class TensorManifest:
    document: Mapping[str, Any]
    source_sha256: str
    source_size: int
    header_size: int
    header_sha256: str
    tensors: Mapping[str, Mapping[str, Any]]

    @property
    def manifest_id(self) -> str:
        return str(self.document["manifestId"])


def load_tensor_manifest(value: Mapping[str, Any], *, expected_manifest_id: str | None = None) -> TensorManifest:
    """Validate a manifest's shape and its content-addressed identity."""

    if not isinstance(value, Mapping) or value.get("schema") != TENSOR_MANIFEST_SCHEMA:
        raise TensorManifestError("tensor manifest schema is invalid")
    without_id = {key: item for key, item in value.items() if key != "manifestId"}
    manifest_id = _sha256(_canonical_json(without_id))
    if value.get("manifestId") != manifest_id:
        raise TensorManifestError("tensor manifest identity does not match its content")
    if expected_manifest_id is not None and manifest_id != expected_manifest_id:
        raise TensorManifestError("tensor manifest is not the expected one")
    source, header, tensors = value.get("source"), value.get("header"), value.get("tensors")
    if not isinstance(source, Mapping) or not isinstance(header, Mapping) or not isinstance(tensors, list):
        raise TensorManifestError("tensor manifest is incomplete")
    config_text = value.get("configText")
    try:
        config_valid = isinstance(config_text, str) and isinstance(json.loads(config_text), dict)
    except ValueError:
        config_valid = False
    if not config_valid:
        raise TensorManifestError("tensor manifest lacks a valid model config")
    source_size = _positive(source.get("sizeBytes"), "source size")
    header_size = _positive(header.get("sizeBytes"), "header size")
    if header_size > min(source_size, MAX_HEADER_BYTES):
        raise TensorManifestError("tensor manifest header size is invalid")
    by_name: dict[str, Mapping[str, Any]] = {}
    for entry in tensors:
        if not isinstance(entry, Mapping) or not isinstance(entry.get("name"), str):
            raise TensorManifestError("tensor manifest entry is invalid")
        offset = _non_negative(entry.get("offset"), "tensor offset")
        size = _positive(entry.get("sizeBytes"), "tensor size")
        if offset < header_size or offset + size > source_size:
            raise TensorManifestError(f"tensor {entry['name']!r} is outside the artifact")
        _digest(entry.get("sha256"))
        if entry["name"] in by_name:
            raise TensorManifestError(f"tensor {entry['name']!r} appears twice")
        by_name[entry["name"]] = entry
    return TensorManifest(
        document=value,
        source_sha256=_digest(source.get("sha256")),
        source_size=source_size,
        header_size=header_size,
        header_sha256=_digest(header.get("sha256")),
        tensors=by_name,
    )


def build_remote_native_gguf_stage(
    fetch: RangeFetcher,
    manifest: TensorManifest,
    destination: str | os.PathLike[str],
    *,
    layer_start: int,
    layer_end: int,
    model_source: str,
    model_revision: str | None,
    total_layers: int | None = None,
) -> NativeGgufStagePackage:
    """Fetch the header and this stage's tensors, verify them and build the package."""

    header = _fetch_exact(fetch, 0, manifest.header_size)
    if _sha256(header) != manifest.header_sha256:
        raise TensorManifestError("GGUF header does not match the tensor manifest")
    version, metadata, tensors, alignment, data_offset = parse_gguf_header(io.BytesIO(header), manifest.source_size)
    if data_offset != manifest.header_size:
        raise TensorManifestError("GGUF data section differs from the tensor manifest")
    if {tensor.name for tensor in tensors} != set(manifest.tensors):
        raise TensorManifestError("GGUF tensors differ from the tensor manifest")
    for tensor in tensors:
        entry = manifest.tensors[tensor.name]
        if entry["offset"] != tensor.data_offset or entry["sizeBytes"] != tensor.size_bytes:
            raise TensorManifestError(f"tensor {tensor.name!r} differs from the tensor manifest")

    metadata_map = {entry.key: entry.value for entry in metadata}
    architecture = metadata_map.get("general.architecture")
    declared = metadata_map.get(f"{architecture}.block_count")
    layers = total_layers if total_layers is not None else declared
    if not isinstance(layers, int):
        raise TensorManifestError("GGUF block count is missing")
    selected = _select_stage_tensors(tensors, layer_start=layer_start, layer_end=layer_end, total_layers=layers)

    target = Path(destination).expanduser().resolve()
    work = Path(tempfile.mkdtemp(prefix=".gguf-fetch-", dir=target.parent if target.parent.exists() else None))
    try:
        # Selected tensors are packed into one local file; the document keeps the
        # complete artifact's identity and points each tensor at its local copy.
        compact = work / "tensors.bin"
        remapped = {}
        with compact.open("wb") as output:
            for tensor in selected:
                entry = manifest.tensors[tensor.name]
                local_offset = output.tell()
                digest = hashlib.sha256()
                fetched = 0
                while fetched < tensor.size_bytes:
                    length = min(_FETCH_CHUNK, tensor.size_bytes - fetched)
                    block = _fetch_exact(fetch, tensor.data_offset + fetched, length)
                    digest.update(block)
                    output.write(block)
                    fetched += length
                if digest.hexdigest() != entry["sha256"]:
                    raise TensorManifestError(f"tensor {tensor.name!r} does not match the tensor manifest")
                remapped[tensor.name] = replace(tensor, data_offset=local_offset)
            output.flush()
            os.fsync(output.fileno())
        config = work / "config.json"
        config.write_bytes(str(manifest.document["configText"]).encode("utf-8"))
        document = GgufDocument(
            path=compact.resolve(),
            version=version,
            metadata=metadata,
            tensors=tuple(remapped.get(tensor.name, tensor) for tensor in tensors),
            alignment=alignment,
            data_offset=data_offset,
            file_sha256=manifest.source_sha256,
        )
        return build_native_gguf_stage(
            compact,
            target,
            config_source=config,
            layer_start=layer_start,
            layer_end=layer_end,
            total_layers=layers,
            model_source=model_source,
            model_revision=model_revision,
            _source_document=document,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


def prepare_remote_native_gguf_stage(
    fetch: RangeFetcher,
    manifest: TensorManifest,
    destination: str | os.PathLike[str],
    *,
    layer_start: int,
    layer_end: int,
    model_source: str,
    model_revision: str | None,
    reuse_verified: bool = False,
) -> NativeGgufStagePackage:
    """Build a stage package, or reuse a verified one built from the same manifest.

    A cached package is reused only when it verifies and names the manifest's
    artifact, config, model coordinates and range. Anything else at the
    destination is discarded and rebuilt, so a damaged cache never runs.
    """

    target = Path(destination).expanduser().resolve()
    if reuse_verified and target.exists():
        config_sha256 = _sha256(str(manifest.document["configText"]).encode("utf-8"))
        try:
            cached = verify_native_gguf_stage(target, expected_layer_start=layer_start, expected_layer_end=layer_end)
        except (NativeGgufError, OSError, ValueError):
            cached = None
        if cached is not None and (
            cached.source_gguf_sha256 == manifest.source_sha256
            and cached.config_sha256 == config_sha256
            and cached.model_source == model_source
            and cached.model_revision == model_revision
        ):
            return cached
        shutil.rmtree(target)
    return build_remote_native_gguf_stage(
        fetch, manifest, target,
        layer_start=layer_start, layer_end=layer_end,
        model_source=model_source, model_revision=model_revision,
    )


def fetch_tensor_manifest(
    url: str,
    *,
    expected_manifest_id: str,
    timeout_seconds: float = 60.0,
    max_bytes: int = MAX_MANIFEST_BYTES,
) -> TensorManifest:
    """Download a tensor manifest over HTTPS and accept only the pinned identity."""

    if not url.startswith("https://"):
        raise ValueError("tensor manifest URLs must use HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "mycellios-node"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            if response.status != 200:
                raise TensorManifestError(f"tensor manifest request returned HTTP {response.status}")
            data = response.read(max_bytes + 1)
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        raise TensorManifestError(f"tensor manifest request failed: {error}") from error
    if len(data) > max_bytes:
        raise TensorManifestError("tensor manifest is too large")
    try:
        document = json.loads(data.decode("utf-8"))
    except ValueError as error:
        raise TensorManifestError("tensor manifest is not JSON") from error
    return load_tensor_manifest(document, expected_manifest_id=expected_manifest_id)


def http_range_fetcher(url: str, *, timeout_seconds: float = 60.0, attempts: int = 3) -> RangeFetcher:
    """Fetch byte ranges over HTTPS, accepting only an exact 206 response."""

    if not url.startswith("https://"):
        raise ValueError("remote GGUF URLs must use HTTPS")

    def fetch(offset: int, length: int) -> bytes:
        last_error: Exception | None = None
        for attempt in range(attempts):
            request = urllib.request.Request(
                url,
                headers={"Range": f"bytes={offset}-{offset + length - 1}", "User-Agent": "mycellios-node"},
            )
            try:
                with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                    if response.status != 206:
                        raise TensorManifestError(f"range request returned HTTP {response.status}")
                    data = response.read(length + 1)
                if len(data) != length:
                    raise TensorManifestError("range response has the wrong length")
                return data
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                last_error = error
                time.sleep(min(8.0, 2.0 ** attempt))
        raise TensorManifestError(f"range request failed: {last_error}")

    return fetch


def file_range_fetcher(path: str | os.PathLike[str]) -> RangeFetcher:
    source = Path(path)

    def fetch(offset: int, length: int) -> bytes:
        with source.open("rb") as handle:
            handle.seek(offset)
            return handle.read(length)

    return fetch


def _fetch_exact(fetch: RangeFetcher, offset: int, length: int) -> bytes:
    data = fetch(offset, length)
    if not isinstance(data, (bytes, bytearray)) or len(data) != length:
        raise TensorManifestError("fetched range has the wrong length")
    return bytes(data)


def _positive(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise TensorManifestError(f"tensor manifest {name} is invalid")
    return value


def _non_negative(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise TensorManifestError(f"tensor manifest {name} is invalid")
    return value


def _digest(value: object) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
        raise TensorManifestError("tensor manifest digest is invalid")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="GGUF tensor manifests and remote stage packages.")
    commands = parser.add_subparsers(dest="command", required=True)
    manifest_command = commands.add_parser("manifest", help="describe a complete local GGUF")
    manifest_command.add_argument("--source", required=True)
    manifest_command.add_argument("--config", required=True)
    manifest_command.add_argument("--output", required=True)
    fetch_command = commands.add_parser("fetch-stage", help="build one stage package from a remote GGUF")
    fetch_command.add_argument("--url", required=True)
    manifest_source = fetch_command.add_mutually_exclusive_group(required=True)
    manifest_source.add_argument("--manifest", help="local tensor manifest file")
    manifest_source.add_argument("--manifest-url", help="HTTPS URL of the tensor manifest")
    fetch_command.add_argument("--manifest-id", required=True)
    fetch_command.add_argument("--destination", required=True)
    fetch_command.add_argument("--layer-start", type=int, required=True)
    fetch_command.add_argument("--layer-end", type=int, required=True)
    fetch_command.add_argument("--model-source", required=True)
    fetch_command.add_argument("--model-revision")
    fetch_command.add_argument("--reuse-verified", action="store_true", help="keep a verified package already at the destination")
    args = parser.parse_args(argv)
    if args.command == "manifest":
        manifest = build_tensor_manifest(args.source, args.config)
        output = Path(args.output)
        temporary = output.with_name(f".{output.name}.{uuid.uuid4().hex}")
        temporary.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8")
        os.replace(temporary, output)
        print(json.dumps({"manifestId": manifest["manifestId"], "tensors": len(manifest["tensors"])}))
        return 0
    if args.manifest_url is not None:
        manifest = fetch_tensor_manifest(args.manifest_url, expected_manifest_id=args.manifest_id)
    else:
        manifest = load_tensor_manifest(
            json.loads(Path(args.manifest).read_text(encoding="utf-8")),
            expected_manifest_id=args.manifest_id,
        )
    package = prepare_remote_native_gguf_stage(
        http_range_fetcher(args.url),
        manifest,
        args.destination,
        layer_start=args.layer_start,
        layer_end=args.layer_end,
        model_source=args.model_source,
        model_revision=args.model_revision,
        reuse_verified=args.reuse_verified,
    )
    print(json.dumps(remote_stage_result(package)))
    return 0


def remote_stage_result(package: NativeGgufStagePackage) -> dict[str, Any]:
    """The JSON line the node's stage preparer reads after ``fetch-stage``."""

    return {
        "destination": str(package.root),
        "packageId": package.package_id,
        "packageIdentity": package.package_identity,
        "modelIdentity": package.artifact_identity,
        "layerStart": package.layer_start,
        "layerEnd": package.layer_end,
        "totalLayers": package.total_layers,
        "weightsSizeBytes": (package.root / "native-stage.gguf").stat().st_size,
    }


if __name__ == "__main__":
    sys.exit(main())
