"""On-demand installation of a pinned llama.cpp build (no network, no binary)."""

from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

from distributed_runtime import llama_cpp_install
from distributed_runtime.llama_cpp_install import (
    gpu_offload,
    https_download,
    install_pinned_build,
    select_build,
)
from distributed_runtime.llama_cpp_runtime import PINNED_BUILDS, LlamaCppRuntimeError, PinnedLlamaCppBuild


LIBRARIES = {"llama.dll": b"llama", "ggml.dll": b"ggml", "ggml-cpu-x64.dll": b"cpu"}


def _archive(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        for name, data in files.items():
            bundle.writestr(name, data)
    return buffer.getvalue()


class InstallTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        # The real archive also ships tools and other libraries; none may be extracted.
        self.archive = _archive({**LIBRARIES, "llama-server-impl.dll": b"tool", "LICENSE": b"MIT"})
        self.build = PinnedLlamaCppBuild(
            build="b0",
            target="win-vulkan-x64",
            archive_sha256=hashlib.sha256(self.archive).hexdigest(),
            archive_url="https://example.invalid/llama.zip",
            archive_size=len(self.archive),
            library_name="llama.dll",
            ggml_name="ggml.dll",
            libraries={name: hashlib.sha256(data).hexdigest() for name, data in LIBRARIES.items()},
        )
        self.pins = mock.patch.dict(llama_cpp_install.PINNED_BUILDS, {"test-build": self.build})
        self.pins.start()
        self.downloads = 0

    def tearDown(self) -> None:
        self.pins.stop()
        self.directory.cleanup()

    def _download(self, payload: bytes | None = None):
        def download(url: str, path: Path, size: int) -> None:
            self.downloads += 1
            self.assertEqual((url, size), (self.build.archive_url, self.build.archive_size))
            path.write_bytes(self.archive if payload is None else payload)
        return download

    def test_installs_only_the_pinned_libraries_and_reuses_them(self) -> None:
        installed = install_pinned_build("test-build", self.root, download=self._download())
        self.assertEqual(installed, (self.root / "test-build").resolve())
        self.assertEqual(sorted(entry.name for entry in installed.iterdir()), sorted(LIBRARIES))
        again = install_pinned_build("test-build", self.root, download=self._download())
        self.assertEqual(again, installed)
        self.assertEqual(self.downloads, 1)
        self.assertEqual([entry.name for entry in self.root.iterdir()], ["test-build"])

    def test_replaces_a_damaged_installation(self) -> None:
        installed = install_pinned_build("test-build", self.root, download=self._download())
        (installed / "ggml.dll").write_bytes(b"patched")
        install_pinned_build("test-build", self.root, download=self._download())
        self.assertEqual((installed / "ggml.dll").read_bytes(), b"ggml")
        self.assertEqual(self.downloads, 2)

    def test_rejects_an_archive_that_differs_from_its_pin(self) -> None:
        tampered = _archive({**LIBRARIES, "ggml.dll": b"evil"})
        with self.assertRaisesRegex(LlamaCppRuntimeError, "does_not_match_its_pin"):
            install_pinned_build("test-build", self.root, download=self._download(tampered))
        self.assertFalse((self.root / "test-build").exists())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_rejects_an_archive_missing_a_pinned_library(self) -> None:
        partial = _archive({"llama.dll": b"llama", "ggml.dll": b"ggml"})
        self.build = PinnedLlamaCppBuild(**{
            **{field: getattr(self.build, field) for field in self.build.__dataclass_fields__},
            "archive_sha256": hashlib.sha256(partial).hexdigest(),
            "archive_size": len(partial),
        })
        llama_cpp_install.PINNED_BUILDS["test-build"] = self.build
        with self.assertRaisesRegex(LlamaCppRuntimeError, "lacks_library:ggml-cpu-x64.dll"):
            install_pinned_build("test-build", self.root, download=self._download(partial))

    def test_rejects_unknown_builds_and_platforms(self) -> None:
        with self.assertRaisesRegex(LlamaCppRuntimeError, "not_pinned"):
            install_pinned_build("llama.cpp-b1-unknown", self.root, download=self._download())
        self.assertEqual(select_build("Windows", "AMD64"), "llama.cpp-b12613-win-vulkan-x64")
        self.assertIn(select_build("Windows", "AMD64"), PINNED_BUILDS)
        with self.assertRaisesRegex(LlamaCppRuntimeError, "unavailable_for_platform:linux-aarch64"):
            select_build("Linux", "aarch64")
        self.assertTrue(gpu_offload(PINNED_BUILDS["llama.cpp-b12613-win-vulkan-x64"]))

    def test_download_requires_https(self) -> None:
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            https_download("http://example.invalid/llama.zip", self.root / "a.zip", 1)


class PinnedArchiveTests(unittest.TestCase):
    def test_pinned_archives_are_official_https_releases(self) -> None:
        for key, build in PINNED_BUILDS.items():
            with self.subTest(key=key):
                self.assertEqual(key, build.runtime_abi)
                self.assertTrue(build.archive_url.startswith(
                    f"https://github.com/ggml-org/llama.cpp/releases/download/{build.build}/"))
                self.assertGreater(build.archive_size, 0)


if __name__ == "__main__":
    unittest.main()
