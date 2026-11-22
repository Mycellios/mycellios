"""Remote native GGUF stage packages built from a tensor manifest and range fetches."""

from __future__ import annotations

import copy
from pathlib import Path
import tempfile
import unittest

from distributed_runtime.native_gguf import build_native_gguf_stage
from distributed_runtime.native_gguf_remote import (
    TensorManifestError,
    build_remote_native_gguf_stage,
    build_tensor_manifest,
    file_range_fetcher,
    http_range_fetcher,
    load_tensor_manifest,
)
from tests.test_llama_cpp_stage import _Fixture


class RemoteStageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.fixture = _Fixture(self.root, layers=3)
        self.document = build_tensor_manifest(self.fixture.source, self.fixture.config)
        self.manifest = load_tensor_manifest(self.document, expected_manifest_id=self.document["manifestId"])
        self.calls: list[tuple[int, int]] = []
        fetch = file_range_fetcher(self.fixture.source)

        def recording(offset: int, length: int) -> bytes:
            self.calls.append((offset, length))
            return fetch(offset, length)

        self.fetch = recording

    def tearDown(self) -> None:
        self.directory.cleanup()

    def _remote(self, start: int, end: int, name: str, fetch=None):
        return build_remote_native_gguf_stage(
            fetch or self.fetch, self.manifest, self.root / name,
            layer_start=start, layer_end=end, model_source="hf://fixture/model", model_revision="a" * 40,
        )

    def test_remote_package_is_byte_identical_to_a_local_build(self) -> None:
        for start, end in ((0, 1), (1, 2), (2, 3), (0, 3)):
            with self.subTest(start=start, end=end):
                local = self.fixture.package(start, end)
                remote = self._remote(start, end, f"remote-{start}-{end}")
                self.assertEqual(remote.package_id, local.package_id)
                self.assertEqual(remote.artifact_identity, local.artifact_identity)
                for name in ("native-stage.gguf", "native-stage.json", "config.json"):
                    self.assertEqual((remote.root / name).read_bytes(), (local.root / name).read_bytes(), name)

    def test_fetches_only_the_header_and_the_stage_tensors(self) -> None:
        self._remote(1, 2, "middle")
        fetched = sum(length for _offset, length in self.calls)
        middle = sum(entry["sizeBytes"] for name, entry in self.manifest.tensors.items() if name.startswith("blk.1."))
        self.assertEqual(self.calls[0], (0, self.manifest.header_size))
        self.assertEqual(fetched, self.manifest.header_size + middle)

    def test_rejects_a_tampered_tensor(self) -> None:
        target = self.manifest.tensors["blk.1.attn_q.weight"]
        fetch = file_range_fetcher(self.fixture.source)

        def tampering(offset: int, length: int) -> bytes:
            data = bytearray(fetch(offset, length))
            if offset == target["offset"]:
                data[0] ^= 0xFF
            return bytes(data)

        with self.assertRaisesRegex(TensorManifestError, "blk.1.attn_q.weight"):
            self._remote(1, 2, "tampered", tampering)
        self.assertFalse((self.root / "tampered").exists())

    def test_rejects_a_tampered_header(self) -> None:
        fetch = file_range_fetcher(self.fixture.source)

        def tampering(offset: int, length: int) -> bytes:
            data = bytearray(fetch(offset, length))
            if offset == 0:
                data[-1] ^= 0x01
            return bytes(data)

        with self.assertRaisesRegex(TensorManifestError, "header"):
            self._remote(0, 1, "header", tampering)

    def test_rejects_a_short_range_response(self) -> None:
        with self.assertRaisesRegex(TensorManifestError, "wrong length"):
            self._remote(0, 1, "short", lambda offset, length: b"\0" * (length - 1))

    def test_manifest_identity_covers_its_content(self) -> None:
        with self.assertRaisesRegex(TensorManifestError, "expected"):
            load_tensor_manifest(self.document, expected_manifest_id="0" * 64)
        changed = copy.deepcopy(self.document)
        changed["tensors"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(TensorManifestError, "identity"):
            load_tensor_manifest(changed)
        for key, value in (("configText", "[]"), ("configText", "not json")):
            broken = copy.deepcopy(self.document)
            broken[key] = value
            broken.pop("manifestId")
            from distributed_runtime.native_gguf import _canonical_json
            import hashlib
            broken["manifestId"] = hashlib.sha256(_canonical_json(broken)).hexdigest()
            with self.subTest(value=value), self.assertRaisesRegex(TensorManifestError, "config"):
                load_tensor_manifest(broken)

    def test_manifest_rejects_tensors_outside_the_artifact(self) -> None:
        import hashlib

        from distributed_runtime.native_gguf import _canonical_json

        broken = copy.deepcopy(self.document)
        broken["tensors"][0]["offset"] = broken["source"]["sizeBytes"]
        broken.pop("manifestId")
        broken["manifestId"] = hashlib.sha256(_canonical_json(broken)).hexdigest()
        with self.assertRaisesRegex(TensorManifestError, "outside"):
            load_tensor_manifest(broken)

    def test_http_fetcher_requires_https(self) -> None:
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            http_range_fetcher("http://example.invalid/model.gguf")


if __name__ == "__main__":
    unittest.main()
