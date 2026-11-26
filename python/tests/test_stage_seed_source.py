from __future__ import annotations

from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest

from distributed_runtime.stage_seed_source import (
    SEED_TOKEN_ENVIRONMENT,
    SEED_TOKEN_HEADER,
    StageSeedSource,
)

try:
    from distributed_runtime.stage_artifact_cache import StageArtifactCache
except ModuleNotFoundError as error:  # pragma: no cover - minimal interpreters
    if error.name not in {"torch", "safetensors", "transformers"}:
        raise
    # The seed path never touches stage compilation; stub only that import so
    # the cache's payload logic can be tested without model libraries.
    stub = types.ModuleType("distributed_runtime.stage_artifact")
    stub.STAGE_ARTIFACT_MANIFEST = "mycellios-stage.json"
    stub.SafeTensorsStageArtifact = object
    stub.parse_stage_artifact_manifest = lambda *_args, **_kwargs: None
    stub.verify_stage_artifact = lambda *_args, **_kwargs: None
    sys.modules["distributed_runtime.stage_artifact"] = stub
    from distributed_runtime.stage_artifact_cache import StageArtifactCache


TOKEN = "t" * 43
PAYLOAD = b"verified stage weights" * 64
DIGEST = hashlib.sha256(PAYLOAD).hexdigest()


@contextmanager
def _server(handler_factory):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_factory)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _seed_endpoint(cache_root: Path, body: bytes, requests: list[dict[str, str]]):
    """A stand-in for the worker endpoint that publishes ``body`` as the object."""

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self) -> None:
            requests.append({"path": self.path, "token": self.headers.get(SEED_TOKEN_HEADER, "")})
            if self.headers.get(SEED_TOKEN_HEADER) != TOKEN:
                self._reply(403, {"ok": False, "code": "artifact_seed_forbidden"})
                return
            target = cache_root / "objects" / "sha256" / DIGEST[:2] / DIGEST
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            self._reply(200, {"ok": True, "published": True})

        def _reply(self, status: int, document: dict[str, object]) -> None:
            value = json.dumps(document).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(value)))
            self.end_headers()
            self.wfile.write(value)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    return Handler


def _origin(requests: list[str]):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            requests.append(self.path)
            self.send_response(200)
            self.send_header("ETag", '"origin-v1"')
            self.send_header("Content-Length", str(len(PAYLOAD)))
            self.end_headers()
            self.wfile.write(PAYLOAD)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    return Handler


class StageSeedSourceTests(unittest.TestCase):
    def test_only_loopback_http_endpoints_and_well_formed_tokens(self) -> None:
        for endpoint in (
            "https://127.0.0.1:9",
            "http://localhost:9",
            "http://10.0.0.2:9",
            "http://127.0.0.1",
            "http://user:pw@127.0.0.1:9",
            "http://127.0.0.1:9/path",
        ):
            with self.assertRaises(ValueError):
                StageSeedSource(endpoint=endpoint, token=TOKEN)
        with self.assertRaises(ValueError):
            StageSeedSource(endpoint="http://127.0.0.1:9", token="short")
        self.assertIsNone(StageSeedSource.from_environment("http://127.0.0.1:9", {}))
        self.assertIsNone(StageSeedSource.from_environment(None, {SEED_TOKEN_ENVIRONMENT: TOKEN}))
        self.assertIsNotNone(
            StageSeedSource.from_environment("http://127.0.0.1:9", {SEED_TOKEN_ENVIRONMENT: TOKEN})
        )

    def test_fetch_sends_the_token_and_reports_only_an_explicit_success(self) -> None:
        requests: list[dict[str, str]] = []
        with tempfile.TemporaryDirectory() as directory, _server(
            _seed_endpoint(Path(directory), PAYLOAD, requests)
        ) as port:
            self.assertTrue(StageSeedSource(f"http://127.0.0.1:{port}", TOKEN).fetch(DIGEST, len(PAYLOAD)))
            self.assertFalse(StageSeedSource(f"http://127.0.0.1:{port}", "x" * 43).fetch(DIGEST, len(PAYLOAD)))
        self.assertEqual(requests[0]["path"], f"/v1/artifact-seed/blobs/{DIGEST}?sizeBytes={len(PAYLOAD)}")
        self.assertEqual(requests[0]["token"], TOKEN)
        self.assertFalse(StageSeedSource(f"http://127.0.0.1:{port}", TOKEN).fetch(DIGEST, len(PAYLOAD)))
        self.assertFalse(StageSeedSource("http://127.0.0.1:9", TOKEN).fetch("not-a-digest", 1))


class StageArtifactCacheSeedTests(unittest.TestCase):
    def _acquire(self, cache: StageArtifactCache, origin_port: int):
        return cache._acquire_payload(
            logical_path="native-stage.safetensors",
            role="weights",
            digest=DIGEST,
            expected_size=len(PAYLOAD),
            source=f"http://127.0.0.1:{origin_port}/native-stage.safetensors",
            source_kind="http",
        )

    def test_a_verified_seed_blob_is_used_before_the_origin(self) -> None:
        seed_requests: list[dict[str, str]] = []
        origin_requests: list[str] = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "cache"
            with _server(_seed_endpoint(root, PAYLOAD, seed_requests)) as seed_port, _server(
                _origin(origin_requests)
            ) as origin_port:
                cache = StageArtifactCache(root, seed=StageSeedSource(f"http://127.0.0.1:{seed_port}", TOKEN))
                result = self._acquire(cache, origin_port)
                self.assertFalse(result.reused)
                self.assertEqual(result.downloaded_bytes, len(PAYLOAD))
                self.assertEqual(cache.object_path(DIGEST).read_bytes(), PAYLOAD)
        self.assertEqual(len(seed_requests), 1)
        self.assertEqual(origin_requests, [])

    def test_a_wrong_seed_blob_is_discarded_and_the_origin_is_used(self) -> None:
        seed_requests: list[dict[str, str]] = []
        origin_requests: list[str] = []
        tampered = bytes([PAYLOAD[0] ^ 1]) + PAYLOAD[1:]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "cache"
            with _server(_seed_endpoint(root, tampered, seed_requests)) as seed_port, _server(
                _origin(origin_requests)
            ) as origin_port:
                cache = StageArtifactCache(root, seed=StageSeedSource(f"http://127.0.0.1:{seed_port}", TOKEN))
                result = self._acquire(cache, origin_port)
                self.assertEqual(hashlib.sha256(cache.object_path(DIGEST).read_bytes()).hexdigest(), DIGEST)
                self.assertFalse(result.reused)
        self.assertEqual(len(seed_requests), 1)
        self.assertEqual(origin_requests, ["/native-stage.safetensors"])

    def test_an_unreachable_seed_falls_back_to_the_origin(self) -> None:
        origin_requests: list[str] = []
        with tempfile.TemporaryDirectory() as directory, _server(_origin(origin_requests)) as origin_port:
            cache = StageArtifactCache(
                Path(directory) / "cache", seed=StageSeedSource("http://127.0.0.1:9", TOKEN)
            )
            self._acquire(cache, origin_port)
            self.assertEqual(cache.object_path(DIGEST).read_bytes(), PAYLOAD)
        self.assertEqual(origin_requests, ["/native-stage.safetensors"])

    def test_local_sources_never_ask_the_seed(self) -> None:
        seed_requests: list[dict[str, str]] = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "cache"
            source = Path(directory) / "weights.bin"
            source.write_bytes(PAYLOAD)
            with _server(_seed_endpoint(root, PAYLOAD, seed_requests)) as seed_port:
                cache = StageArtifactCache(root, seed=StageSeedSource(f"http://127.0.0.1:{seed_port}", TOKEN))
                cache._acquire_payload(
                    logical_path="native-stage.safetensors",
                    role="weights",
                    digest=DIGEST,
                    expected_size=len(PAYLOAD),
                    source=str(source),
                    source_kind="local",
                )
        self.assertEqual(seed_requests, [])


if __name__ == "__main__":
    unittest.main()
