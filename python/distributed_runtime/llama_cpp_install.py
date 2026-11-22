"""Install a pinned llama.cpp build on a node, on demand.

A node needs llama.cpp only when the coordinator routes a native GGUF stage to
its llama.cpp executor. The first such stage installs the build:

1. the official release archive is downloaded over HTTPS, bounded by its
   pinned size, and accepted only with its pinned SHA-256;
2. only the pinned libraries are extracted, by exact flat name, so nothing
   else in the archive ever reaches the build directory;
3. the directory is verified library by library (``verify_build_directory``)
   and then moved into place atomically under ``<cache>/<build key>``.

Later stages reuse a directory that still verifies; a damaged one is replaced.
Every library is hash-pinned, so a mirror or cache may serve the archive
without being trusted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import tempfile
from typing import Callable, Sequence
import urllib.error
import urllib.request
import zipfile

from .llama_cpp_runtime import (
    PINNED_BUILDS,
    LlamaCppRuntimeError,
    PinnedLlamaCppBuild,
    verify_build_directory,
)

_DOWNLOAD_CHUNK = 1 << 20
_DOWNLOAD_TIMEOUT_SECONDS = 120.0

Downloader = Callable[[str, Path, int], None]
"""Write at most ``size`` bytes from ``url`` to ``path``."""


def select_build(system: str | None = None, machine: str | None = None) -> str:
    """The pinned build key for this node, or an error naming why there is none."""

    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    if system == "windows" and machine in {"amd64", "x86_64"}:
        # One archive covers every x64 CPU (per-generation CPU backends) and
        # any Vulkan GPU; without a GPU, llama.cpp keeps every block on the CPU.
        return "llama.cpp-b12613-win-vulkan-x64"
    raise LlamaCppRuntimeError(f"llama_cpp_build_unavailable_for_platform:{system}-{machine}")


def gpu_offload(build: PinnedLlamaCppBuild) -> bool:
    return any(backend in build.target for backend in ("vulkan", "cuda", "metal"))


def install_pinned_build(
    build_key: str,
    cache_root: str | os.PathLike[str],
    *,
    download: Downloader | None = None,
) -> Path:
    """Return a verified directory holding exactly the pinned build's libraries."""

    build = PINNED_BUILDS.get(build_key)
    if build is None:
        raise LlamaCppRuntimeError(f"llama_cpp_build_is_not_pinned:{build_key}")
    root = Path(cache_root).expanduser().resolve()
    target = root / build_key
    if target.exists():
        try:
            return verify_build_directory(target, build)
        except LlamaCppRuntimeError:
            shutil.rmtree(target)
    root.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=".llama-cpp-install-", dir=root))
    try:
        archive = work / "archive.zip"
        (download or https_download)(build.archive_url, archive, build.archive_size)
        if archive.stat().st_size != build.archive_size or _sha256_file(archive) != build.archive_sha256:
            raise LlamaCppRuntimeError("llama_cpp_archive_does_not_match_its_pin")
        libraries = work / build_key
        libraries.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            for name in sorted(build.libraries):
                if "/" in name or "\\" in name:
                    raise LlamaCppRuntimeError(f"llama_cpp_pinned_library_name_is_invalid:{name}")
                try:
                    info = bundle.getinfo(name)
                except KeyError as error:
                    raise LlamaCppRuntimeError(f"llama_cpp_archive_lacks_library:{name}") from error
                with bundle.open(info) as source, (libraries / name).open("wb") as output:
                    shutil.copyfileobj(source, output, _DOWNLOAD_CHUNK)
        verify_build_directory(libraries, build)
        try:
            os.replace(libraries, target)
        except OSError:
            # Another installer finished first; keep its copy if it verifies.
            if not target.exists():
                raise
        return verify_build_directory(target, build)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def https_download(url: str, path: Path, size: int) -> None:
    if not url.startswith("https://"):
        raise ValueError("llama.cpp archives must be downloaded over HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "mycellios-node"})
    try:
        with urllib.request.urlopen(request, timeout=_DOWNLOAD_TIMEOUT_SECONDS) as response, path.open("wb") as output:
            if response.status != 200 or not response.geturl().startswith("https://"):
                raise LlamaCppRuntimeError(f"llama_cpp_archive_download_returned_http_{response.status}")
            written = 0
            while True:
                block = response.read(_DOWNLOAD_CHUNK)
                if not block:
                    break
                written += len(block)
                if written > size:
                    raise LlamaCppRuntimeError("llama_cpp_archive_is_larger_than_its_pin")
                output.write(block)
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        raise LlamaCppRuntimeError(f"llama_cpp_archive_download_failed:{error}") from error


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_DOWNLOAD_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Install the pinned llama.cpp build for this node.")
    parser.add_argument("--cache", required=True, help="directory that holds installed builds")
    parser.add_argument("--build", help="pinned build key; chosen from this platform when omitted")
    args = parser.parse_args(argv)
    key = args.build or select_build()
    directory = install_pinned_build(key, args.cache)
    print(json.dumps({"build": key, "buildDirectory": str(directory), "gpuOffload": gpu_offload(PINNED_BUILDS[key])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
