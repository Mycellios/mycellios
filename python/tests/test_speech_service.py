import json
import threading
import unittest
import urllib.error
import urllib.request

from distributed_runtime import speech_service as service


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


class FlakyGuard:
    def __init__(self, failures_after):
        self.remaining = failures_after

    def check(self, force=False):
        if self.remaining <= 0:
            raise RuntimeError("reservation lapsed")
        self.remaining -= 1


def request(port, path, body=None, headers=None):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    sent = {"Content-Type": "application/json"} if data is not None else {}
    sent.update(headers or {})
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, headers=sent,
                                 method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


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

    def test_rejects_unknown_routes_and_mismatched_tasks(self):
        for path in ("/models/other/transcribe", "/models/mycellios-kokoro-es/transcribe", "/models/../health",
                     "/models/mycellios-whisper-small/transcribe/x", "/transcribe"):
            self.assertEqual(request(self.unified, path, {"audio": "ok"})[0], 404, path)

    def test_maps_errors_like_the_previous_runtimes(self):
        self.assertEqual(request(self.legacy_whisper, "/transcribe", {"audio": "busy"}), (429, {"error": "transcription_busy"}))
        self.assertEqual(request(self.legacy_whisper, "/transcribe", {"audio": "bad"}),
                         (422, {"error": "invalid_audio_or_transcript"}))
        self.assertEqual(request(self.legacy_whisper, "/transcribe", b"{}", {"Content-Type": "text/plain"})[0], 413)
        self.assertEqual(request(self.legacy_whisper, "/transcribe", b"x" * 1_300_001)[0], 413)
        self.assertEqual(request(self.legacy_kokoro, "/synthesize", {"text": "x", "extra": 1}),
                         (400, {"error": "invalid_or_oversized_speech"}))
        self.assertEqual(request(self.legacy_kokoro, "/synthesize", b"x" * 4097)[0], 400)
        self.assertEqual(request(self.legacy_kokoro, "/synthesize", {"text": "boom"}),
                         (503, {"error": "speech_generation_failed"}))

    def test_an_unloaded_model_fails_closed_while_others_keep_serving(self):
        self.whisper.unload()
        self.assertEqual(request(self.legacy_whisper, "/health"), (503, {"error": "transcription_unavailable"}))
        self.assertEqual(request(self.unified, "/models/mycellios-whisper-small/transcribe", {"audio": "ok"}),
                         (503, {"error": "transcription_unavailable"}))
        self.assertEqual(request(self.unified, "/health")[1]["models"][0]["loaded"], False)
        self.assertEqual(request(self.legacy_kokoro, "/synthesize", {"text": "hi"})[0], 200)


class ReservationAndConfigTests(unittest.TestCase):
    def test_unloads_a_gpu_model_when_its_reservation_lapses(self):
        slot = service.WhisperSlot(FakeWhisper())
        thread = threading.Thread(target=service.watch_reservation, args=(slot, FlakyGuard(2)),
                                  kwargs={"interval": 0, "sleep": lambda _: None})
        thread.start()
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(slot.loaded)

    def test_validates_models_and_distinct_loopback_ports(self):
        config = service.load_config(json.dumps({"port": 8895, "models": {
            "mycellios-whisper-small": {"legacyPort": 8892}, "mycellios-kokoro-es": {"legacyPort": 8890}}}))
        self.assertEqual(sorted(config["models"]), ["mycellios-kokoro-es", "mycellios-whisper-small"])
        for raw in ({"models": {"other": {}}}, {"port": 8890, "models": {"mycellios-kokoro-es": {"legacyPort": 8890}}},
                    {"port": 80, "models": {}}, {"models": {}, "extra": 1}, {"models": []}):
            with self.assertRaises(ValueError):
                service.load_config(json.dumps(raw))

    def test_binds_only_loopback(self):
        with self.assertRaises(ValueError):
            service.start_server(service.legacy_handler(service.KokoroSlot(FakeKokoro())), 0, host="0.0.0.0")


if __name__ == "__main__":
    unittest.main()
