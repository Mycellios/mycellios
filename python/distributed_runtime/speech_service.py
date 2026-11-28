"""One loopback speech service per node (specs/speech-replica).

Hosts every configured speech model in one process ("Ollama for voice"):

* one unified API on the service port: ``GET /health`` lists the loaded
  models, ``GET /models/<id>/health`` and ``POST /models/<id>/<task>`` run a
  model;
* each model's previous API on its previous loopback port, byte-for-byte the
  same routes and bodies, so deployed workers keep their adapter configs and
  native qualification.

The engines themselves are the existing, source-pinned modules
(``transcription_engine.py``, ``kokoro_engine.py``); this file only routes
requests to them. A model whose GPU reservation lapses is unloaded so its
memory returns to the shared budget, while the other models keep serving.
Request bodies, audio and text are never logged.
"""
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RUNTIME = "mycellios-speech/1"
LOOPBACK_HOSTS = ("127.0.0.1", "localhost")
MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")


class SlotUnavailable(Exception):
    """The model is not loaded (never started or unloaded)."""


class ModelSlot:
    """One catalog model: its task route, body bounds and error mapping."""

    model = ""
    task = ""
    max_body = 0
    oversized_status = 400
    invalid_status = 400
    invalid_error = "invalid_request"
    busy_error = "busy"
    failed_error = "unavailable"
    invalid_exceptions = (ValueError,)
    require_json = True

    def __init__(self, engine):
        self.engine = engine
        self.lock = threading.Lock()

    @property
    def loaded(self):
        return self.engine is not None

    def _engine(self):
        engine = self.engine
        if engine is None:
            raise SlotUnavailable(self.model)
        return engine

    def health(self):
        raise NotImplementedError

    def run(self, body):
        raise NotImplementedError

    def unload(self):
        """Drops the engine so its memory can be reclaimed; requests then fail closed."""
        with self.lock:
            self.engine = None


class WhisperSlot(ModelSlot):
    model = "mycellios-whisper-small"
    task = "transcribe"
    max_body = 1_300_000
    oversized_status = 413
    invalid_status = 422
    invalid_error = "invalid_audio_or_transcript"
    busy_error = "transcription_busy"
    failed_error = "transcription_unavailable"

    def health(self):
        engine = self._engine()
        return {"status": "ready", "model": self.model, "artifact_identity": engine.digest,
                "runtime": "mycellios-transcription-runtime/1", "tokenizer": "cl100k_base",
                "execution": engine.execution()}

    def run(self, body):
        return self._engine().transcribe(body)

    def unload(self):
        super().unload()
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass


class KokoroSlot(ModelSlot):
    model = "mycellios-kokoro-es"
    task = "synthesize"
    max_body = 4096
    invalid_error = "invalid_or_oversized_speech"
    busy_error = "speech_capacity_exhausted"
    failed_error = "speech_generation_failed"
    invalid_exceptions = (ValueError, TypeError, UnicodeError)
    require_json = False  # The previous Kokoro API never required a content type.

    def health(self):
        kokoro = _kokoro_module()
        self._engine()
        return {"status": "ready", "model": self.model, "artifact_identity": "sha256:" + kokoro.WEIGHT_SHA256,
                "runtime": "mycellios-kokoro/2", "tokenizer": "cl100k_base",
                "default_language": "en", "languages": ["en", "es"], "voices": list(kokoro.VOICES),
                "speed_range": [0.5, 2]}

    def run(self, body):
        if not isinstance(body, dict) or "text" not in body or set(body) - {"text", "language", "voice", "speed"}:
            raise ValueError("invalid_speech_request")
        return self._engine().synthesize(**body)


def _kokoro_module():
    try:
        import kokoro_engine
    except ImportError:  # Imported as a package, as in the repository tests.
        from distributed_runtime import kokoro_engine
    return kokoro_engine


def _reply(handler, status, value):
    data = json.dumps(value, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    try:
        handler.wfile.write(data)
    except (BrokenPipeError, ConnectionResetError):
        pass


def _health(handler, slot):
    try:
        return _reply(handler, 200, slot.health())
    except Exception:
        return _reply(handler, 503, {"error": slot.failed_error})


def _run(handler, slot):
    try:
        if handler.headers.get("Transfer-Encoding"):
            raise ValueError("chunked_upload_not_supported")
        size = int(handler.headers.get("Content-Length", "0"))
        if not 1 <= size <= slot.max_body or (slot.require_json and handler.headers.get("Content-Type") != "application/json"):
            return _reply(handler, slot.oversized_status, {"error": slot.invalid_error})
        handler.connection.settimeout(5)
        data = handler.rfile.read(size)
        if len(data) != size:
            raise ValueError("incomplete_request")
        return _reply(handler, 200, slot.run(json.loads(data)))
    except BlockingIOError:
        return _reply(handler, 429, {"error": slot.busy_error})
    except SlotUnavailable:
        return _reply(handler, 503, {"error": slot.failed_error})
    except slot.invalid_exceptions:
        return _reply(handler, slot.invalid_status, {"error": slot.invalid_error})
    except Exception:
        return _reply(handler, 503, {"error": slot.failed_error})


def unified_handler(slots):
    """The service API: every model under /models/<id>/, plus an aggregate /health."""
    by_model = {slot.model: slot for slot in slots}

    class Handler(BaseHTTPRequestHandler):
        timeout = 10

        def log_message(self, *_):
            pass  # Never log audio, text or request bodies.

        def _route(self, action):
            parts = self.path.split("/")
            if len(parts) != 4 or parts[0] or parts[1] != "models" or not MODEL_ID.match(parts[2]):
                return None
            slot = by_model.get(parts[2])
            return slot if slot and parts[3] == action(slot) else None

        def do_GET(self):
            if self.path == "/health":
                return _reply(self, 200, {"status": "ready", "runtime": RUNTIME, "models": [
                    {"model": slot.model, "task": slot.task, "loaded": slot.loaded} for slot in slots]})
            slot = self._route(lambda _slot: "health")
            return _health(self, slot) if slot else _reply(self, 404, {"error": "not_found"})

        def do_POST(self):
            slot = self._route(lambda found: found.task)
            return _run(self, slot) if slot else _reply(self, 404, {"error": "not_found"})

    return Handler


def legacy_handler(slot):
    """A model's previous single-model API, unchanged: GET /health and POST /<task>."""

    class Handler(BaseHTTPRequestHandler):
        timeout = 10

        def log_message(self, *_):
            pass

        def do_GET(self):
            return _health(self, slot) if self.path == "/health" else _reply(self, 404, {"error": "not_found"})

        def do_POST(self):
            return _run(self, slot) if self.path == "/" + slot.task else _reply(self, 404, {"error": "not_found"})

    return Handler


def start_server(handler, port, host="127.0.0.1"):
    if host not in LOOPBACK_HOSTS:
        raise ValueError("speech_service_requires_loopback")
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def watch_reservation(slot, guard, interval=5.0, sleep=time.sleep):
    """Unloads a GPU model as soon as its reservation can no longer be confirmed."""
    while slot.loaded:
        sleep(interval)
        try:
            guard.check(force=True)
        except Exception:
            slot.unload()
            return


def load_config(raw):
    config = json.loads(raw)
    if not isinstance(config, dict) or set(config) - {"port", "models"} or not isinstance(config.get("models"), dict):
        raise ValueError("invalid_speech_service_config")
    port = config.get("port", 8895)
    ports = [port]
    for model, entry in config["models"].items():
        if model not in (WhisperSlot.model, KokoroSlot.model) or not isinstance(entry, dict):
            raise ValueError("unknown_speech_model")
        if "legacyPort" in entry:
            ports.append(entry["legacyPort"])
    if any(type(value) is not int or not 1024 <= value <= 65535 for value in ports) or len(set(ports)) != len(ports):
        raise ValueError("invalid_speech_service_ports")
    return config


def build_slots(config):
    """Loads each configured engine from its existing source-pinned module."""
    slots, guards = [], []
    whisper = config["models"].get(WhisperSlot.model)
    if whisper is not None:
        from replica_gpu_guard import GpuReservationGuard
        from transcription_engine import TranscriptionEngine
        gpu = json.loads(Path(whisper["gpuConfig"]).read_text(encoding="utf-8-sig"))
        manifest = json.loads(Path(whisper["artifacts"]).read_text())
        guard = GpuReservationGuard(gpu)
        slot = WhisperSlot(TranscriptionEngine(Path(whisper["modelPath"]), manifest, guard))
        slots.append(slot)
        guards.append((slot, guard))
    if KokoroSlot.model in config["models"]:
        from kokoro_engine import SpeechEngine
        slots.append(KokoroSlot(SpeechEngine()))
    return slots, guards


def main():
    config = load_config(Path(os.environ["MYCELLIOS_SPEECH_SERVICE_CONFIG"]).read_text(encoding="utf-8-sig"))
    slots, guards = build_slots(config)
    for slot, guard in guards:
        threading.Thread(target=watch_reservation, args=(slot, guard), daemon=True).start()
    servers = [start_server(unified_handler(slots), config.get("port", 8895))]
    for slot in slots:
        port = config["models"][slot.model].get("legacyPort")
        if port is not None:
            servers.append(start_server(legacy_handler(slot), port))
    print(json.dumps({"status": "ready", "runtime": RUNTIME, "models": [slot.model for slot in slots]}), flush=True)
    while any(slot.loaded for slot in slots):
        time.sleep(1)
    # Every model was unloaded: exit so the launcher can restart cleanly.
    for server in servers:
        server.shutdown()


if __name__ == "__main__":
    main()
