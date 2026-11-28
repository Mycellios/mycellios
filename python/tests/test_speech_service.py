import array
import base64
import hashlib
import http.client
import http.server
import importlib.util
import inspect
import io
import json
import math
import pathlib
import sys
import tempfile
import threading
import types
import unittest
import urllib.error
import urllib.request
import wave
from unittest import mock

from distributed_runtime import speech_service as service
from distributed_runtime.replica_gpu_guard import GpuReservationGuard

RUNTIME_DIR = pathlib.Path(service.__file__).parent
KOKORO_CUDA_CORE_SHA256 = "cb695aae55a47a3345b82295f6646a192ecdd8407818c4c5a9984a71d27e3229"
NODE_TRANSCRIPTION_ENGINE_SHA256 = "b5b4cc02bd4444ff75b0cd916b1e5e5d5e2091945b3a75e6f4bde5cf9f7def44"
TIMELINE = "https://www.mycellios.com/public/v1/requested-models/mycellios-whisper-small/timeline"


class FakeWhisper:
    digest = "sha256:" + "1" * 64

    def __init__(self):
        self.calls = 0

    def execution(self):
        return {"backend": "cuda"}

    def transcribe(self, body):
        self.calls += 1
        if body.get("audio") == "busy":
            raise BlockingIOError("busy")
        if body.get("audio") == "bad":
            raise ValueError("bad")
        return {"model": "mycellios-whisper-small", "content": "{}", "input_tokens": 1, "tokenizer": "cl100k_base"}


class FakeKokoro:
    def synthesize(self, text, **options):
        if text == "boom":
            raise RuntimeError("engine failure")
        return {"model": "mycellios-kokoro-es", "content": json.dumps({"text": text, **options}),
                "input_tokens": 1, "tokenizer": "cl100k_base"}


def request(port, path, body=None, headers=None, with_headers=False):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    sent = {"Content-Type": "application/json"} if data is not None else {}
    sent.update(headers or {})
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, headers=sent,
                                 method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = response.status, json.loads(response.read())
            return (*result, response.headers) if with_headers else result
    except urllib.error.HTTPError as error:
        result = error.code, json.loads(error.read())
        return (*result, error.headers) if with_headers else result


def declared_size(port, path, size):
    """Declares an oversized body without sending it: the service must refuse from the header alone."""
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.putrequest("POST", path)
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Content-Length", str(size))
        connection.endheaders()
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


class SpeechServiceTests(unittest.TestCase):
    def setUp(self):
        self.whisper = service.WhisperSlot(FakeWhisper())
        self.kokoro = service.KokoroSlot(FakeKokoro())
        slots = [self.whisper, self.kokoro]
        self.servers = [service.start_server(service.unified_handler(slots), 0),
                        service.start_server(service.legacy_handler(self.whisper), 0),
                        service.start_server(service.legacy_handler(self.kokoro), 0)]
        self.unified, self.legacy_whisper, self.legacy_kokoro = (server.server_address[1] for server in self.servers)

    def tearDown(self):
        for server in self.servers:
            server.shutdown()
            server.server_close()

    def test_lists_models_and_serves_each_through_one_api(self):
        status, health = request(self.unified, "/health")
        self.assertEqual(status, 200)
        self.assertEqual(health, {"status": "ready", "runtime": "mycellios-speech/1", "models": [
            {"model": "mycellios-whisper-small", "task": "transcribe", "loaded": True},
            {"model": "mycellios-kokoro-es", "task": "synthesize", "loaded": True}]})
        status, body = request(self.unified, "/models/mycellios-whisper-small/transcribe", {"audio": "ok"})
        self.assertEqual((status, body["model"]), (200, "mycellios-whisper-small"))
        status, body = request(self.unified, "/models/mycellios-kokoro-es/synthesize", {"text": "hola", "language": "es"})
        self.assertEqual((status, json.loads(body["content"])), (200, {"text": "hola", "language": "es"}))
        status, body = request(self.unified, "/models/mycellios-kokoro-es/health")
        self.assertEqual((status, body["runtime"], body["voices"][0]), (200, "mycellios-kokoro/2", "af_heart"))

    def test_keeps_each_previous_single_model_api(self):
        status, body = request(self.legacy_whisper, "/health")
        self.assertEqual((status, body["runtime"], body["artifact_identity"], body["execution"]),
                         (200, "mycellios-transcription-runtime/1", FakeWhisper.digest, {"backend": "cuda"}))
        self.assertEqual(request(self.legacy_whisper, "/transcribe", {"audio": "ok"})[0], 200)
        self.assertEqual(request(self.legacy_kokoro, "/synthesize", {"text": "hi"})[0], 200)
        # A model's old port serves only that model's task.
        self.assertEqual(request(self.legacy_whisper, "/synthesize", {"text": "hi"})[0], 404)
        self.assertEqual(request(self.legacy_kokoro, "/transcribe", {"audio": "ok"})[0], 404)
        self.assertEqual(request(self.legacy_kokoro, "/metrics")[0], 404)  # Only the CUDA wrapper had /metrics.

    def test_rejects_unknown_routes_and_mismatched_tasks(self):
        for path in ("/models/other/transcribe", "/models/mycellios-kokoro-es/transcribe", "/models/../health",
                     "/models/mycellios-whisper-small/transcribe/x", "/transcribe"):
            self.assertEqual(request(self.unified, path, {"audio": "ok"})[0], 404, path)

    def test_maps_errors_like_the_previous_runtimes(self):
        self.assertEqual(request(self.legacy_whisper, "/transcribe", {"audio": "busy"}), (429, {"error": "transcription_busy"}))
        self.assertEqual(request(self.legacy_whisper, "/transcribe", {"audio": "bad"}),
                         (422, {"error": "invalid_audio_or_transcript"}))
        self.assertEqual(request(self.legacy_whisper, "/transcribe", b"{}", {"Content-Type": "text/plain"})[0], 413)
        self.assertEqual(declared_size(self.legacy_whisper, "/transcribe", 1_300_001)[0], 413)
        self.assertEqual(request(self.legacy_kokoro, "/synthesize", {"text": "x", "extra": 1}),
                         (400, {"error": "invalid_or_oversized_speech"}))
        self.assertEqual(declared_size(self.legacy_kokoro, "/synthesize", 4097)[0], 400)
        self.assertEqual(request(self.legacy_kokoro, "/synthesize", {"text": "boom"}),
                         (503, {"error": "speech_generation_failed"}))

    def test_an_unloaded_model_fails_closed_while_others_keep_serving(self):
        self.whisper.unload()
        self.assertEqual(request(self.legacy_whisper, "/health"), (503, {"error": "transcription_unavailable"}))
        self.assertEqual(request(self.unified, "/models/mycellios-whisper-small/transcribe", {"audio": "ok"}),
                         (503, {"error": "transcription_unavailable"}))
        self.assertEqual(request(self.unified, "/health")[1]["models"][0]["loaded"], False)
        self.assertEqual(request(self.legacy_kokoro, "/synthesize", {"text": "hi"})[0], 200)


class TimelineFetchTests(unittest.TestCase):
    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_):
            self.close()

    def scripted(self, *outcomes):
        calls = []

        def open_url(request, timeout):
            calls.append((request.full_url, timeout, request.get_header("Cache-control")))
            outcome = outcomes[len(calls) - 1]
            if isinstance(outcome, BaseException):
                raise outcome
            return self.Response(outcome)
        return calls, open_url

    def http_error(self, code):
        return urllib.error.HTTPError(TIMELINE, code, "error", {}, io.BytesIO(b""))

    def test_retries_transport_failures_with_a_longer_timeout_and_short_backoff(self):
        sleeps = []
        calls, open_url = self.scripted(TimeoutError("read timed out"), urllib.error.URLError("reset"),
                                        b'{"data": {"reservations": []}}')
        fetch = service.RetryingTimelineFetch(TIMELINE, sleep=sleeps.append, open_url=open_url)
        self.assertEqual(fetch(), {"data": {"reservations": []}})
        self.assertEqual([call[1] for call in calls], [8.0, 8.0, 8.0])
        self.assertTrue(all(call[0] == TIMELINE and call[2] == "no-cache" for call in calls))
        self.assertEqual(sleeps, [0.5, 1.0])

    def test_reports_exhausted_retries_and_5xx_as_transport_errors(self):
        for outcomes in ((OSError("down"),) * 3, (self.http_error(503),) * 3, (http.client.IncompleteRead(b""),) * 3):
            calls, open_url = self.scripted(*outcomes)
            with self.assertRaises(service.LeaseTransportError):
                service.RetryingTimelineFetch(TIMELINE, sleep=lambda _: None, open_url=open_url)()
            self.assertEqual(len(calls), 3)

    def test_definitive_answers_are_not_retried(self):
        for outcome in (self.http_error(404), b"x" * (service.MAX_TIMELINE_BYTES + 1), b"not json",
                        ValueError("gpu_reservation_redirect_rejected")):
            calls, open_url = self.scripted(outcome, b"{}")
            with self.assertRaises(ValueError) as caught:
                service.RetryingTimelineFetch(TIMELINE, sleep=lambda _: None, open_url=open_url)()
            self.assertNotIsInstance(caught.exception, service.LeaseTransportError)
            self.assertEqual(len(calls), 1)

    def test_requires_https_and_refuses_redirects(self):
        for url in ("http://www.mycellios.com/x", "https://user:pw@www.mycellios.com/x", "file:///etc/passwd"):
            with self.assertRaises(ValueError):
                service.RetryingTimelineFetch(url)
        default = service.RetryingTimelineFetch(TIMELINE)
        self.assertTrue(any(isinstance(h, service._NoRedirect) for h in default.open_url.__self__.handlers))

        class Redirect(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.1:1/elsewhere")
                self.send_header("Content-Length", "0")
                self.end_headers()
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with self.assertRaisesRegex(ValueError, "redirect_rejected"):
                service.timeline_opener().open(f"http://127.0.0.1:{server.server_address[1]}/", timeout=5)
        finally:
            server.shutdown()
            server.server_close()


class ReservationFixture(unittest.TestCase):
    """A real, source-pinned GpuReservationGuard with a scripted timeline and clock."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.owner, self.state = root / "owner.json", root / "state.json"
        self.owner.write_text(json.dumps({"nodeId": "physical-1", "policy": {"modelAllowlist": [],
            "schedule": [{"days": list(range(7)), "startMinuteUtc": 0, "endMinuteUtc": 1440}]}}))
        self.set_owner(True)
        self.now = 1_000_000
        self.cfg = {"timelineUrl": TIMELINE, "modelId": "mycellios-whisper-small", "modelDigest": "sha256:" + "a" * 64,
                    "memoryMiB": 2048, "consumerId": "owned-asr", "nodeId": "physical-1", "deviceName": "GPU",
                    "gpuCoreSourceSha256": "b" * 64, "nativeConfigPath": str(self.owner),
                    "nativeStatePath": str(self.state)}
        self.expires_at = self.now + 90_000
        self.timeline = "ok"
        self.fetches = 0
        self.keeper = service.LeaseKeeper(GpuReservationGuard(self.cfg, fetch=self.fetch, clock=lambda: self.now))

    def tearDown(self):
        self.temp.cleanup()

    def set_owner(self, enabled):
        self.state.write_text(json.dumps({"contributionEnabled": enabled, "draining": False}))

    def row(self):
        return {"id": "reservation-1", "status": "committed", "modelId": self.cfg["modelId"],
                "expiresAt": self.expires_at, "stages": [{"nodeId": "physical-1", "memoryMiB": 2048}],
                "canary": {"consumerId": "owned-asr", "nodeId": "physical-1", "passed": True, "backend": "cuda",
                           "precision": "float32", "modelDigest": self.cfg["modelDigest"],
                           "gpuCoreSourceSha256": self.cfg["gpuCoreSourceSha256"]}}

    def fetch(self):
        self.fetches += 1
        if self.timeline == "down":
            raise service.LeaseTransportError("gpu_reservation_transport_failed")
        if self.timeline == "released":
            return {"data": {"reservations": []}}
        return {"data": {"reservations": [self.row()]}}


class LeaseKeeperTests(ReservationFixture):
    def test_transient_failure_serves_only_inside_the_last_confirmed_lease(self):
        self.assertEqual(self.keeper.check(force=True)["id"], "reservation-1")
        self.timeline = "down"
        self.now += 24_000
        self.assertEqual(self.keeper.check(force=True)["id"], "reservation-1")
        self.now += 2_000  # 26 s since the last confirmation: beyond the transport grace.
        with self.assertRaises(service.LeaseTransportError):
            self.keeper.check(force=True)

    def test_never_serves_within_the_guard_margin_of_the_confirmed_expiry(self):
        self.expires_at = self.now + 30_000
        self.keeper.check(force=True)
        self.timeline = "down"
        self.now += 9_000
        self.assertEqual(self.keeper.check(force=True)["expiresAt"], self.expires_at)
        self.now += 2_000  # Expiry is now 19 s away, inside the guard's own 20 s margin.
        with self.assertRaises(service.LeaseTransportError):
            self.keeper.check(force=True)

    def test_definitive_answers_revoke_the_confirmed_lease(self):
        self.keeper.check(force=True)
        self.timeline = "released"
        with self.assertRaisesRegex(ValueError, "missing_or_ambiguous"):
            self.keeper.check(force=True)
        self.timeline = "down"
        with self.assertRaises(service.LeaseTransportError):
            self.keeper.check(force=True)  # Nothing left to fall back on.
        self.assertIsNone(self.keeper.guard.cached)

    def test_owner_pause_is_enforced_even_during_a_network_outage(self):
        self.keeper.check(force=True)
        self.timeline = "down"
        self.set_owner(False)
        with self.assertRaisesRegex(ValueError, "owner_paused"):
            self.keeper.check(force=True)

    def test_concurrent_callers_use_the_bounded_fallback_instead_of_waiting(self):
        self.keeper.check(force=True)
        release = threading.Event()
        started = threading.Event()

        def slow_fetch():
            started.set()
            release.wait(5)
            return {"data": {"reservations": [self.row()]}}
        self.keeper.guard.fetch = slow_fetch
        worker = threading.Thread(target=self.keeper.check, kwargs={"force": True})
        worker.start()
        started.wait(5)
        self.assertEqual(self.keeper.check(force=True)["id"], "reservation-1")
        release.set()
        worker.join(5)


class FakeCuda:
    def __init__(self):
        self.fractions = []
        self.emptied = 0

    def is_initialized(self):
        return True

    def synchronize(self):
        pass

    def empty_cache(self):
        self.emptied += 1

    def get_device_properties(self, _device):
        return types.SimpleNamespace(total_memory=6144 * service.MIB)

    def set_per_process_memory_fraction(self, fraction, device=0):
        self.fractions.append((round(fraction * 6144), device))


class SupervisionTests(ReservationFixture):
    def supervised(self, steps, slot):
        """Runs the supervisor for a fixed number of iterations, advancing the clock by each sleep."""
        trace = []

        def sleep(seconds):
            trace.append((round(seconds, 1), slot.loaded))
            self.now += int(seconds * 1000)
        service.supervise(slot, interval=5.0, max_backoff=60.0, sleep=sleep, stop=lambda: len(trace) >= steps)
        return trace

    def whisper(self):
        self.loads = 0

        def loader():
            self.loads += 1
            return FakeWhisper()
        return service.WhisperSlot(loader=loader, keeper=self.keeper)

    def test_a_transient_failure_keeps_serving_until_the_confirmed_margin_then_unloads(self):
        slot = self.whisper()
        trace = self.supervised(1, slot)
        self.assertEqual((trace, self.loads), ([(5.0, True)], 1))
        self.timeline = "down"
        trace = self.supervised(6, slot)
        # Confirmed at t=0 s; checks at 5..25 s still serve, the one at 30 s is past the 25 s grace.
        self.assertEqual([loaded for _, loaded in trace], [True, True, True, True, True, False])
        self.assertEqual(request_status(slot), 503)

    def test_a_definitive_failure_unloads_at_once(self):
        slot = self.whisper()
        self.supervised(1, slot)
        self.timeline = "released"
        trace = self.supervised(1, slot)
        self.assertEqual(trace, [(5.0, False)])

    def test_reloads_when_a_new_lease_is_confirmed_and_never_exits(self):
        slot = self.whisper()
        self.timeline = "released"
        trace = self.supervised(6, slot)
        self.assertEqual(trace, [(10.0, False), (20.0, False), (40.0, False), (60.0, False), (60.0, False),
                                 (60.0, False)])
        self.assertEqual(self.loads, 0)  # Nothing loads without a committed reservation.
        self.timeline = "ok"
        self.expires_at = self.now + 90_000
        trace = self.supervised(1, slot)
        self.assertEqual((trace, self.loads), ([(5.0, True)], 1))
        self.assertEqual(request_status(slot), 200)

    def test_a_failed_load_is_retried_and_released(self):
        attempts = []

        def loader():
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("native_cuda_audio_silent")
            return FakeWhisper()
        slot = service.WhisperSlot(loader=loader, keeper=self.keeper)
        self.assertEqual(self.supervised(2, slot), [(10.0, False), (5.0, True)])

    def test_unloading_waits_for_running_requests_and_releases_gpu_memory(self):
        cuda = FakeCuda()
        budget = service.CudaAllocatorBudget()
        with budget.loading("mycellios-whisper-small", 2048, types.SimpleNamespace(cuda=cuda)):
            budget.torch.cuda.set_per_process_memory_fraction(1536 / 6144)
        slot = service.WhisperSlot(FakeWhisper(), budget=budget)
        done = []
        with mock.patch.dict(sys.modules, {"torch": types.SimpleNamespace(cuda=cuda)}):
            with slot.using():
                unloading = threading.Thread(target=lambda: (slot.unload(), done.append(True)))
                unloading.start()
                unloading.join(0.2)
                self.assertEqual((done, cuda.emptied, slot.loaded), ([], 0, False))
            unloading.join(5)
        self.assertEqual((done, cuda.emptied, budget.limit_mib()), ([True], 1, 0))


def request_status(slot):
    server = service.start_server(service.legacy_handler(slot), 0)
    try:
        return request(server.server_address[1], "/transcribe", {"audio": "ok"})[0]
    finally:
        server.shutdown()
        server.server_close()


class AllocatorBudgetTests(unittest.TestCase):
    def test_process_fraction_is_the_sum_of_each_loaded_models_bounded_share(self):
        cuda = FakeCuda()
        torch = types.SimpleNamespace(cuda=cuda)
        original = cuda.set_per_process_memory_fraction
        budget = service.CudaAllocatorBudget()
        with budget.loading("mycellios-whisper-small", 2048, torch):
            torch.cuda.set_per_process_memory_fraction(1536 / 6144)  # As transcription_engine.py does.
        with budget.loading("mycellios-kokoro-es", 768, torch):
            torch.cuda.set_per_process_memory_fraction(0.20, 0)  # As the Kokoro core does: capped at 768 MiB.
        self.assertEqual(cuda.fractions, [(1536, 0), (2304, 0)])
        self.assertEqual((budget.limit_mib("mycellios-kokoro-es"), budget.limit_mib()), (768, 2304))
        budget.release("mycellios-kokoro-es")
        self.assertEqual(cuda.fractions[-1], (1536, 0))
        with self.assertRaisesRegex(RuntimeError, "unbound"):
            torch.cuda.set_per_process_memory_fraction(0.5)
        self.assertIsNot(torch.cuda.set_per_process_memory_fraction, original)


class FakeParameter:
    def __init__(self, dtype, device="cuda"):
        self.dtype, self.device = dtype, types.SimpleNamespace(type=device)


class FakeKeeper:
    def __init__(self, config):
        self.config, self.guard, self.fail = config, FakeGuard(), False

    def check(self, force=False):
        if self.fail:
            raise ValueError("gpu_reservation_missing_or_ambiguous")
        return {"id": "reservation-k", "expiresAt": 9_999_999_999_999}


class FakeGuard:
    pass


FAKE_CORE = '''
import base64, hashlib, io, json, wave, array, types
MODEL = "mycellios-kokoro-es"
WEIGHT_SHA256 = "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4"
VOICES = ("af_heart", "am_michael", "ef_dora", "em_alex", "em_santa")
AMPLITUDE = %d

class SpeechEngine:
    def __init__(self):
        import torch
        torch.cuda.set_per_process_memory_fraction(0.20, 0)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        model = types.SimpleNamespace(parameters=lambda: iter(torch.PARAMETERS))
        self.pipelines = {"es": types.SimpleNamespace(model=model)}

    def synthesize(self, text, language="en", voice=None, speed=1):
        out = io.BytesIO()
        with wave.open(out, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
            wav.writeframes(array.array("h", [AMPLITUDE, -AMPLITUDE] * 1200).tobytes())
        raw = out.getvalue()
        envelope = {"audio": {"sha256": hashlib.sha256(raw).hexdigest(), "data": base64.b64encode(raw).decode()}}
        return {"model": MODEL, "content": json.dumps(envelope), "input_tokens": 2, "tokenizer": "cl100k_base"}
'''


class KokoroCudaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def torch(self, device_name="NVIDIA GeForce RTX 2060", dtype="float32"):
        cuda = FakeCuda()
        cuda.device_count = lambda: 1
        cuda.get_device_name = lambda _device: device_name
        cuda.max_memory_allocated = lambda: 400 * service.MIB
        cuda.max_memory_reserved = lambda: 500 * service.MIB
        torch = types.SimpleNamespace(cuda=cuda, float32="float32", __version__="2.fake",
                                      backends=types.SimpleNamespace(cuda=types.SimpleNamespace(matmul=types.SimpleNamespace(allow_tf32=True)),
                                                                     cudnn=types.SimpleNamespace(allow_tf32=True)))
        torch.PARAMETERS = [FakeParameter(dtype)]
        return torch

    def engine(self, torch, amplitude=8000, core_sha=None, memory=2048):
        core = self.root / "core.py"
        core.write_text(FAKE_CORE % amplitude)
        cfg = {"gpuCoreSourceSha256": core_sha or hashlib.sha256(core.read_bytes()).hexdigest(), "memoryMiB": memory,
               "deviceName": "NVIDIA GeForce RTX 2060", "modelDigest": "sha256:" + "4" * 64, "nodeId": "node-1",
               "consumerId": "kokoro-gpu-1"}
        keeper = FakeKeeper(cfg)
        budget = service.CudaAllocatorBudget()
        with mock.patch.dict(sys.modules, {"torch": torch}):
            return service.KokoroCudaEngine(core, keeper, budget, torch), keeper, budget

    def test_reproduces_the_wrapper_invariants_and_evidence(self):
        torch = self.torch()
        engine, keeper, budget = self.engine(torch)
        self.assertEqual(budget.limit_mib("mycellios-kokoro-es"), 768)  # 0.20 of 6 GiB, capped at 768 MiB.
        self.assertEqual(engine.native_canary["scope"], "native-startup-canary-not-a-user-job")
        self.assertGreater(engine.native_canary["pcmRms"], 50)
        evidence = engine.execution()
        self.assertEqual({key: evidence[key] for key in ("backend", "precision", "tf32", "deviceName", "allocatorLimitMiB")},
                         {"backend": "cuda", "precision": "float32", "tf32": False,
                          "deviceName": "NVIDIA GeForce RTX 2060", "allocatorLimitMiB": 768})
        self.assertEqual(evidence["wrapperSourceSha256"], hashlib.sha256(pathlib.Path(service.__file__).read_bytes()).hexdigest())
        self.assertEqual(evidence["guardSourceSha256"], hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest())
        self.assertEqual(evidence["reservation"], {"id": "reservation-k", "nodeId": "node-1", "consumerId": "kokoro-gpu-1",
                                                   "memoryMiB": 2048, "expiresAt": 9_999_999_999_999})

        slot = service.KokoroCudaSlot(engine)
        server = service.start_server(service.legacy_handler(slot), 0)
        port = server.server_address[1]
        try:
            status, health = request(port, "/health")
            self.assertEqual((status, health["artifact_identity"], health["runtime"], health["execution"]["nativeCanary"]["passed"]),
                             (200, "sha256:496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4", "mycellios-kokoro/2", True))
            self.assertLess(len(json.dumps(health)), 4096)  # The adapter reads at most 4096 bytes of health.
            status, body, headers = request(port, "/synthesize", {"text": "Hola", "language": "es"}, with_headers=True)
            self.assertEqual((status, body["input_tokens"]), (200, 2))
            self.assertRegex(headers["Server-Timing"], r"^lease;dur=[0-9.]+, synthesize;dur=[0-9.]+$")
            self.assertEqual(request(port, "/metrics")[1]["recent"][0]["reservationId"], "reservation-k")
            self.assertEqual(request(port, "/synthesize", {"text": "x", "extra": 1}), (400, {"error": "invalid_or_oversized_speech"}))
            keeper.fail = True  # Lease check before every synthesis.
            self.assertEqual(request(port, "/synthesize", {"text": "Hola"}), (503, {"error": "speech_generation_or_admission_failed"}))
            self.assertEqual(request(port, "/health"), (503, {"error": "qualified_gpu_reservation_unavailable"}))
            slot.unload()
            self.assertEqual(request(port, "/synthesize", {"text": "Hola"}), (503, {"error": "speech_generation_or_admission_failed"}))
            self.assertEqual(request(port, "/metrics")[0], 200)
        finally:
            server.shutdown()
            server.server_close()

    def test_refuses_an_unqualified_core_device_precision_budget_or_silent_canary(self):
        cases = [({"core_sha": "0" * 64}, "qualified_gpu_core_changed"), ({"memory": 4096}, "unqualified_gpu_budget"),
                 ({"amplitude": 10}, "native_cuda_audio_silent")]
        for kwargs, error in cases:
            with self.assertRaisesRegex(RuntimeError, error):
                self.engine(self.torch(), **kwargs)
        with self.assertRaisesRegex(RuntimeError, "device_changed"):
            self.engine(self.torch(device_name="Other GPU"))
        with self.assertRaisesRegex(RuntimeError, "fp32_evidence"):
            self.engine(self.torch(dtype="float16"))

    def test_the_qualified_core_stays_byte_identical(self):
        # Reservation canaries pin gpuCoreSourceSha256 to this exact file.
        self.assertEqual(hashlib.sha256((RUNTIME_DIR / "kokoro_cuda_core.py").read_bytes()).hexdigest(),
                         KOKORO_CUDA_CORE_SHA256)


class TranscriptionEngineCompatibilityTests(ReservationFixture):
    def test_the_node_pinned_engine_differs_only_in_line_endings_and_accepts_the_keeper(self):
        source = (RUNTIME_DIR / "transcription_engine.py").read_bytes()
        node_copy = source.replace(b"\n", b"\r\n")  # The node's b5b4cc02 copy is this file with CRLF line endings.
        self.assertEqual(hashlib.sha256(node_copy).hexdigest(), NODE_TRANSCRIPTION_ENGINE_SHA256)
        folder = pathlib.Path(self.temp.name)
        (folder / "transcription_engine.py").write_bytes(node_copy)
        (folder / "replica_gpu_guard.py").write_bytes((RUNTIME_DIR / "replica_gpu_guard.py").read_bytes())
        modules = []
        for path in (RUNTIME_DIR / "transcription_engine.py", folder / "transcription_engine.py"):
            spec = importlib.util.spec_from_file_location("transcription_engine_%d" % len(modules), path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            modules.append(module)
        repo, node = modules
        self.assertEqual(str(inspect.signature(repo.TranscriptionEngine.__init__)),
                         str(inspect.signature(node.TranscriptionEngine.__init__)))
        # execution() reads the lease and config through whatever guard it was given: the keeper here.
        fake = types.SimpleNamespace(guard=self.keeper, device_name="GPU", artifacts_sha256="c" * 64)
        evidence = node.TranscriptionEngine.execution(fake)
        self.assertEqual(evidence["gpuCoreSourceSha256"], NODE_TRANSCRIPTION_ENGINE_SHA256)
        self.assertEqual(evidence["guardSourceSha256"], "e2a5761e8ef10de43d448ae50ddc8ec07747b83afde7beeb58cd16abf5600f67")
        self.assertEqual(evidence["reservation"]["consumerId"], "owned-asr")


class ConfigTests(unittest.TestCase):
    def test_validates_models_and_distinct_loopback_ports(self):
        config = service.load_config(json.dumps({"port": 8895, "models": {
            "mycellios-whisper-small": {"legacyPort": 8892}, "mycellios-kokoro-es": {"legacyPort": 8890}}}))
        self.assertEqual(sorted(config["models"]), ["mycellios-kokoro-es", "mycellios-whisper-small"])
        for raw in ({"models": {"other": {}}}, {"port": 8890, "models": {"mycellios-kokoro-es": {"legacyPort": 8890}}},
                    {"port": 80, "models": {}}, {"models": {}, "extra": 1}, {"models": []},
                    {"models": {"mycellios-kokoro-es": {"gpuConfig": "gpu-reservation.json"}}}):
            with self.assertRaises(ValueError):
                service.load_config(json.dumps(raw))

    def test_binds_only_loopback(self):
        with self.assertRaises(ValueError):
            service.start_server(service.legacy_handler(service.KokoroSlot(FakeKokoro())), 0, host="0.0.0.0")


if __name__ == "__main__":
    unittest.main()
