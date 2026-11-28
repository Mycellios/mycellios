"""One loopback speech service per node (specs/speech-replica).

Hosts every configured speech model in one process ("Ollama for voice"):

* one unified API on the service port: ``GET /health`` lists the configured
  models and whether each is loaded, ``GET /models/<id>/health`` and
  ``POST /models/<id>/<task>`` run a model;
* each model's previous API on its previous loopback port, byte-for-byte the
  same routes, bodies and error codes, so deployed workers keep their adapter
  configs and native qualification.

The engines themselves are the existing, source-pinned modules
(``transcription_engine.py``, ``kokoro_engine.py`` and the qualified CUDA
Kokoro core ``kokoro_cuda_core.py``); this file only routes requests to them
and binds GPU models to their coordinator reservations.

A GPU model is loaded only while its committed reservation is confirmed. A
transient failure to read the coordinator timeline (network, timeout, HTTP
5xx) keeps the model serving only inside the last confirmed lease; a definitive
answer (owner paused or draining, schedule closed, identity or expiry invalid,
reservation missing) unloads it at once. An unloaded model releases its GPU
memory, answers 503 with its usual error code and is loaded again when a
committed reservation is confirmed; the process itself never exits because of
a reservation. Request bodies, audio and text are never logged.
"""
import array
import base64
import contextlib
import gc
import hashlib
import http.client
import importlib.util
import io
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RUNTIME = "mycellios-speech/1"
LOOPBACK_HOSTS = ("127.0.0.1", "localhost")
MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")
MIB = 1024 ** 2

# Same bounds as replica_gpu_guard.py: a lease must outlive the check by 20 s.
LEASE_MARGIN_MS = 20_000
# A transport failure is tolerated at most this long after the last confirmed
# lease. It stays below the coordinator's default releaseGapMs (30 s,
# src/coordinator/native-replica-placement.ts), during which a released
# reservation's memory is not granted to another replica, so a replica that
# cannot see a release still stops before the memory can be reused.
TRANSIENT_GRACE_MS = 25_000
MAX_TIMELINE_BYTES = 1_048_576


class SlotUnavailable(Exception):
    """The model is not loaded (never started, loading or unloaded)."""


class LeaseTransportError(Exception):
    """The reservation timeline could not be read; says nothing about the lease itself."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError("gpu_reservation_redirect_rejected")


def timeline_opener():
    """An opener that refuses every redirect, like the guard's own fetch."""
    return urllib.request.build_opener(_NoRedirect())


class RetryingTimelineFetch:
    """The guard's timeline fetch with a longer timeout and bounded retries.

    Keeps the guard's safety properties: HTTPS origin only, no redirects and a
    1 MiB response cap. Only transport failures are retried and reported as
    ``LeaseTransportError``; redirects, oversized or malformed bodies and HTTP
    4xx stay ``ValueError`` so the caller treats them as definitive.
    """

    def __init__(self, url, timeout=8.0, attempts=3, backoff=(0.5, 1.0), sleep=time.sleep, open_url=None):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
            raise ValueError("invalid_gpu_reservation_origin")
        if not 1 <= attempts <= 5 or not 0 < timeout <= 15:
            raise ValueError("invalid_gpu_reservation_fetch_bounds")
        self.url, self.timeout, self.attempts, self.backoff, self.sleep = url, timeout, attempts, backoff, sleep
        self.open_url = open_url or timeline_opener().open

    def once(self):
        request = urllib.request.Request(self.url, headers={
            "User-Agent": "Mycellios-Native-GPU-Reservation/1", "Cache-Control": "no-cache"})
        try:
            with self.open_url(request, timeout=self.timeout) as response:
                raw = response.read(MAX_TIMELINE_BYTES + 1)
        except urllib.error.HTTPError as error:
            error.close()
            if error.code >= 500 or error.code == 429:
                raise LeaseTransportError("gpu_reservation_http_%d" % error.code) from error
            raise ValueError("gpu_reservation_http_%d" % error.code) from error
        except ValueError:
            raise
        except (OSError, http.client.HTTPException) as error:  # URLError, timeouts, resets, TLS.
            raise LeaseTransportError("gpu_reservation_transport_failed") from error
        if len(raw) > MAX_TIMELINE_BYTES:
            raise ValueError("gpu_reservation_response_too_large")
        return json.loads(raw)

    def __call__(self):
        for attempt in range(self.attempts):
            try:
                return self.once()
            except LeaseTransportError:
                if attempt + 1 >= self.attempts:
                    raise
                self.sleep(self.backoff[min(attempt, len(self.backoff) - 1)])


class LeaseKeeper:
    """A GpuReservationGuard that survives transient timeline failures, fail-closed.

    It is passed to the engines in place of the guard (same ``check`` and
    ``config``). Every check still runs the guard's owner policy. A transport
    failure returns the last confirmed lease only while it was confirmed less
    than ``grace_ms`` ago and expires more than the guard's 20 s margin from
    now; any other failure revokes the lease. While one caller reads the
    timeline, concurrent callers use the same bounded fallback instead of
    starting another slow read.
    """

    def __init__(self, guard, grace_ms=TRANSIENT_GRACE_MS, margin_ms=LEASE_MARGIN_MS):
        self.guard = guard
        self.config = guard.config
        self.grace_ms, self.margin_ms = grace_ms, margin_ms
        self._fetching = threading.Lock()
        self._state = threading.Lock()
        self.lease = None
        self.confirmed_at = None

    def check(self, force=False):
        if not self._fetching.acquire(blocking=False):
            return self._last_confirmed()
        try:
            try:
                lease = self.guard.check(force=force)
            except LeaseTransportError:
                return self._last_confirmed()
            except Exception:
                self.revoke()
                raise
            with self._state:
                self.lease, self.confirmed_at = lease, self.guard.checked_at
            return lease
        finally:
            self._fetching.release()

    def revoke(self):
        with self._state:
            self.lease = self.confirmed_at = None
        self.guard.cached = None  # The guard must not reuse it through its own 2 s cache either.

    def _last_confirmed(self):
        now = self.guard.clock()
        try:
            self.guard.owner_check(now)
        except Exception:
            self.revoke()
            raise
        with self._state:
            lease, confirmed_at = self.lease, self.confirmed_at
        if (lease is None or not 0 <= now - confirmed_at <= self.grace_ms
                or lease["expiresAt"] <= now + self.margin_ms):
            raise LeaseTransportError("gpu_reservation_unconfirmed")
        return lease


class CudaAllocatorBudget:
    """One process has one CUDA caching allocator, so one memory fraction.

    Each engine still calls ``torch.cuda.set_per_process_memory_fraction`` with
    its own qualified budget. That call is attributed to the model being
    loaded, bounded by its cap, and the process fraction becomes the sum of
    the loaded models' limits; unloading a model removes its share.
    """

    def __init__(self):
        self.torch = None
        self.original = None
        self.limits = {}
        self.current = None
        self.lock = threading.RLock()

    def _install(self, torch):
        if self.torch is None:
            self.torch = torch
            self.original = torch.cuda.set_per_process_memory_fraction
            torch.cuda.set_per_process_memory_fraction = self._set_fraction

    @contextlib.contextmanager
    def loading(self, model, cap_mib, torch):
        with self.lock:
            self._install(torch)
            self.current = (model, cap_mib)
            try:
                yield self
            except BaseException:
                self.limits.pop(model, None)
                raise
            finally:
                self.current = None

    def _total(self):
        return self.torch.cuda.get_device_properties(0).total_memory

    def _set_fraction(self, fraction, device=0):
        with self.lock:
            if self.current is None:
                raise RuntimeError("unbound_cuda_memory_fraction")
            if device not in (0, None):
                raise RuntimeError("unqualified_cuda_device")
            model, cap_mib = self.current
            self.limits[model] = min(float(fraction) * self._total(), cap_mib * MIB)
            self._apply()

    def _apply(self):
        if self.limits:
            self.original(min(1.0, sum(self.limits.values()) / self._total()), 0)

    def limit_mib(self, model=None):
        with self.lock:
            value = self.limits.get(model, 0) if model else sum(self.limits.values())
            return round(value / MIB)

    def release(self, model):
        with self.lock:
            if self.limits.pop(model, None) is not None:
                self._apply()


def _release_cuda_memory():
    gc.collect()
    torch = sys.modules.get("torch")  # Never import torch just to unload a CPU model.
    if torch is not None:
        try:
            if torch.cuda.is_initialized():
                torch.cuda.synchronize()
                torch.cuda.empty_cache()
        except Exception:
            pass


def _describe(error):
    return type(error).__name__ + ":" + str(error)[:120]


def _log(event, model, error=None):
    """Error codes only: never request bodies, audio or text."""
    record = {"event": event, "model": model}
    if error is not None:
        record["error"] = error
    print(json.dumps(record), file=sys.stderr, flush=True)


class ModelSlot:
    """One catalog model: its task route, body bounds, error mapping and lifecycle."""

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
    gpu_cap_mib = None
    unload_wait_seconds = 150

    def __init__(self, engine=None, loader=None, keeper=None, budget=None):
        self.engine = engine
        self.loader = loader
        self.keeper = keeper
        self.budget = budget
        self.lock = threading.Condition()
        self.active = 0

    @property
    def loaded(self):
        return self.engine is not None

    @property
    def health_error(self):
        return self.failed_error

    def extra_routes(self):
        """Additional GET routes of the previous API (path -> callable returning JSON)."""
        return {}

    def _engine(self):
        engine = self.engine
        if engine is None:
            raise SlotUnavailable(self.model)
        return engine

    @contextlib.contextmanager
    def using(self):
        """Holds the engine for one request so unloading waits before freeing GPU memory."""
        with self.lock:
            engine = self._engine()
            self.active += 1
        try:
            yield engine
        finally:
            with self.lock:
                self.active -= 1
                self.lock.notify_all()

    def health(self):
        raise NotImplementedError

    def run(self, body):
        raise NotImplementedError

    def respond(self, body):
        """The response body plus extra headers; most models add none."""
        return self.run(body), {}

    def confirm(self):
        """Raises when the model may no longer serve (its reservation is not confirmed)."""
        if self.keeper is not None:
            self.keeper.check(force=True)

    def load(self):
        if self.loaded:
            return
        if self.loader is None:
            raise SlotUnavailable(self.model)
        self.confirm()  # A GPU model loads only under a committed, confirmed reservation.
        with _LOAD_LOCK:  # One model at a time: memory fractions are attributed per load.
            engine = self.loader()
        with self.lock:
            self.engine = engine

    def unload(self):
        """Drops the engine, waits for running requests and releases its GPU memory."""
        with self.lock:
            had_engine = self.engine is not None
            self.engine = None
            deadline = time.monotonic() + self.unload_wait_seconds
            while self.active and time.monotonic() < deadline:
                self.lock.wait(max(0.0, deadline - time.monotonic()))
        if had_engine or self.loader is not None:
            _release_cuda_memory()
        if self.budget is not None:
            self.budget.release(self.model)


_LOAD_LOCK = threading.Lock()


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
        with self.using() as engine:
            return engine.transcribe(body)


def _validate_speech_body(body):
    if not isinstance(body, dict) or "text" not in body or set(body) - {"text", "language", "voice", "speed"}:
        raise ValueError("invalid_speech_request")


class KokoroSlot(ModelSlot):
    """CPU Kokoro (``kokoro_engine.py``): loaded once, no GPU reservation."""

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
        _validate_speech_body(body)
        with self.using() as engine:
            return engine.synthesize(**body)


def _kokoro_module():
    try:
        import kokoro_engine
    except ImportError:  # Imported as a package, as in the repository tests.
        from distributed_runtime import kokoro_engine
    return kokoro_engine


def _sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class KokoroCudaEngine:
    """The qualified CUDA Kokoro core under the invariants of its former wrapper.

    Byte-identical core (its hash is the reservation canary's
    ``gpuCoreSourceSha256``), one physical device with the configured name, a
    768 MiB allocator limit inside the 2048 MiB reservation, fp32 weights with
    TF32 off, a lease check before every synthesis and an unbilled native
    startup canary on every load.
    """

    ALLOCATOR_LIMIT_MIB = 768

    def __init__(self, core_path, keeper, budget, torch, model="mycellios-kokoro-es"):
        cfg = keeper.config
        if _sha256_file(core_path) != cfg["gpuCoreSourceSha256"]:
            raise RuntimeError("qualified_gpu_core_changed")
        if cfg["memoryMiB"] != 2048:
            raise RuntimeError("unqualified_gpu_budget")
        self.cfg, self.keeper, self.budget, self.torch, self.model = cfg, keeper, budget, torch, model
        if torch.cuda.device_count() != 1 or torch.cuda.get_device_name(0) != cfg["deviceName"]:
            raise RuntimeError("qualified_physical_cuda_device_changed")
        spec = importlib.util.spec_from_file_location("qualified_gpu_speech_core", core_path)
        core = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(core)
        if core.MODEL != model:
            raise RuntimeError("qualified_gpu_core_model_changed")
        os.environ["MYCELLIOS_SPEECH_DEVICE"] = "cuda"  # The core selects its device from this variable.
        with budget.loading(model, self.ALLOCATOR_LIMIT_MIB, torch):
            self.engine = core.SpeechEngine()
        self.core = core
        weights = self.engine.pipelines["es"].model
        if (next(weights.parameters()).device.type != "cuda"
                or any(p.dtype != torch.float32 for p in weights.parameters())
                or torch.backends.cuda.matmul.allow_tf32 or torch.backends.cudnn.allow_tf32):
            raise RuntimeError("native_cuda_fp32_evidence_failed")
        self.device_name = torch.cuda.get_device_name(0)
        self.native_canary = None
        self.native_canary = self._startup_canary()

    def synthesize(self, value):
        _validate_speech_body(value)
        begun = time.monotonic()
        try:
            lease = self.keeper.check()
        except Exception as error:
            raise RuntimeError("gpu_reservation_unavailable") from error
        admission = (time.monotonic() - begun) * 1000
        started = time.monotonic()
        result = self.engine.synthesize(**value)
        self.torch.cuda.synchronize()
        elapsed = (time.monotonic() - started) * 1000
        envelope = json.loads(result["content"])
        raw = base64.b64decode(envelope["audio"]["data"], validate=True)
        if hashlib.sha256(raw).hexdigest() != envelope["audio"]["sha256"]:
            raise RuntimeError("native_audio_hash_failed")
        sample = dict(audioSha256=envelope["audio"]["sha256"], inputTokens=result["input_tokens"],
                      audioBytes=len(raw), leaseMs=round(admission, 3), synthesizeMs=round(elapsed, 3),
                      reservationId=lease["id"], backend="cuda", precision="float32")
        return result, sample

    def _startup_canary(self):
        """A real, explicitly unbilled native canary, before admitting network work."""
        warm, _ = self.synthesize(dict(text="Voz conectada.", language="es", voice="ef_dora", speed=1))
        envelope = json.loads(warm["content"])
        with wave.open(io.BytesIO(base64.b64decode(envelope["audio"]["data"]))) as wav:
            if wav.getframerate() != 24000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise RuntimeError("native_cuda_wav_format_failed")
            pcm = array.array("h", wav.readframes(wav.getnframes()))
        rms = math.sqrt(sum(float(x) * x for x in pcm) / max(1, len(pcm)))
        if rms <= 50:
            raise RuntimeError("native_cuda_audio_silent")
        return dict(passed=True, voice="ef_dora", speed=1, language="es",
                    inputTokens=warm["input_tokens"], audioSha256=envelope["audio"]["sha256"],
                    pcmRms=rms, scope="native-startup-canary-not-a-user-job")

    def execution(self):
        lease = self.keeper.check()
        torch, cfg = self.torch, self.cfg
        guard_module = sys.modules[type(self.keeper.guard).__module__]
        return dict(backend="cuda", precision="float32", tf32=False, deviceName=self.device_name,
                    torchVersion=torch.__version__, modelDigest=cfg["modelDigest"],
                    gpuCoreSourceSha256=cfg["gpuCoreSourceSha256"],
                    # The unified service is this replica's wrapper now.
                    wrapperSourceSha256=_sha256_file(__file__),
                    guardSourceSha256=_sha256_file(guard_module.__file__),
                    peakAllocatedBytes=torch.cuda.max_memory_allocated(),
                    peakReservedBytes=torch.cuda.max_memory_reserved(),
                    allocatorLimitMiB=self.ALLOCATOR_LIMIT_MIB,
                    # Peaks are process-wide: every model of this service shares one allocator.
                    processAllocatorLimitMiB=self.budget.limit_mib(),
                    reservation=dict(id=lease["id"], nodeId=cfg["nodeId"], consumerId=cfg["consumerId"],
                                     memoryMiB=cfg["memoryMiB"], expiresAt=lease["expiresAt"]),
                    nativeCanary=self.native_canary)


class KokoroCudaSlot(KokoroSlot):
    """CUDA Kokoro with the previous wrapper's API on port 8890 (``/metrics``, Server-Timing)."""

    failed_error = "speech_generation_or_admission_failed"
    gpu_cap_mib = KokoroCudaEngine.ALLOCATOR_LIMIT_MIB

    def __init__(self, engine=None, loader=None, keeper=None, budget=None):
        super().__init__(engine, loader, keeper, budget)
        self.recent = []
        self.metrics_lock = threading.Lock()

    @property
    def health_error(self):
        return "qualified_gpu_reservation_unavailable"

    def extra_routes(self):
        return {"/metrics": self.metrics}

    def metrics(self):
        with self.metrics_lock:
            return dict(recent=list(self.recent))

    def health(self):
        engine = self._engine()
        core = engine.core
        evidence = engine.execution()
        return dict(status="ready", model=core.MODEL, artifact_identity="sha256:" + core.WEIGHT_SHA256,
                    runtime="mycellios-kokoro/2", tokenizer="cl100k_base", default_language="en",
                    languages=["en", "es"], voices=list(core.VOICES), speed_range=[0.5, 2], execution=evidence)

    def respond(self, body):
        _validate_speech_body(body)
        with self.using() as engine:
            result, sample = engine.synthesize(body)
        with self.metrics_lock:
            self.recent.append(sample)
            del self.recent[:-32]
        timing = "lease;dur=%s, synthesize;dur=%s" % (sample["leaseMs"], sample["synthesizeMs"])
        return result, {"Server-Timing": timing}

    def run(self, body):
        return self.respond(body)[0]


def _reply(handler, status, value, headers=None):
    data = json.dumps(value, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    for name, header in (headers or {}).items():
        handler.send_header(name, header)
    handler.end_headers()
    try:
        handler.wfile.write(data)
    except (BrokenPipeError, ConnectionResetError):
        pass


def _health(handler, slot):
    try:
        return _reply(handler, 200, slot.health())
    except Exception:
        return _reply(handler, 503, {"error": slot.health_error})


def _extra(handler, slot, route):
    try:
        return _reply(handler, 200, route())
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
        value, headers = slot.respond(json.loads(data))
        return _reply(handler, 200, value, headers)
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

        def _route(self):
            parts = self.path.split("/")
            if len(parts) != 4 or parts[0] or parts[1] != "models" or not MODEL_ID.match(parts[2]):
                return None, None
            return by_model.get(parts[2]), parts[3]

        def do_GET(self):
            if self.path == "/health":
                return _reply(self, 200, {"status": "ready", "runtime": RUNTIME, "models": [
                    {"model": slot.model, "task": slot.task, "loaded": slot.loaded} for slot in slots]})
            slot, action = self._route()
            if slot and action == "health":
                return _health(self, slot)
            route = slot.extra_routes().get("/" + action) if slot else None
            return _extra(self, slot, route) if route else _reply(self, 404, {"error": "not_found"})

        def do_POST(self):
            slot, action = self._route()
            return _run(self, slot) if slot and action == slot.task else _reply(self, 404, {"error": "not_found"})

    return Handler


def legacy_handler(slot):
    """A model's previous single-model API, unchanged: GET /health, POST /<task> and its extra routes."""

    class Handler(BaseHTTPRequestHandler):
        timeout = 10

        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path == "/health":
                return _health(self, slot)
            route = slot.extra_routes().get(self.path)
            return _extra(self, slot, route) if route else _reply(self, 404, {"error": "not_found"})

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


def supervise(slot, interval=5.0, max_backoff=60.0, sleep=time.sleep, stop=lambda: False):
    """Keeps one model loaded exactly while it may serve; never gives up while configured.

    A loaded GPU model is confirmed every ``interval`` seconds and unloaded as
    soon as its reservation is no longer confirmed (definitive failures at
    once, transport failures after the last confirmed lease runs out). An
    unloaded model is retried with exponential backoff up to ``max_backoff``
    and loaded again once a committed reservation is confirmed.
    """
    delay = interval
    while not stop():
        failure = None  # A description only: a kept traceback would pin the engine's GPU memory.
        if slot.loaded:
            try:
                slot.confirm()
                delay = interval
            except Exception as error:
                failure = ("model_unloaded", _describe(error))
        else:
            try:
                slot.load()
                _log("model_loaded", slot.model)
                delay = interval
            except Exception as error:
                failure = ("model_unavailable", _describe(error))
        if failure is not None:
            slot.unload()  # Also releases whatever a failed load allocated.
            if failure[0] == "model_unloaded" or delay in (interval, max_backoff):
                _log(failure[0], slot.model, failure[1])
            if failure[0] == "model_unavailable":
                delay = min(max_backoff, delay * 2)
        sleep(delay)


def load_config(raw):
    config = json.loads(raw)
    if not isinstance(config, dict) or set(config) - {"port", "models"} or not isinstance(config.get("models"), dict):
        raise ValueError("invalid_speech_service_config")
    port = config.get("port", 8895)
    ports = [port]
    for model, entry in config["models"].items():
        if model not in (WhisperSlot.model, KokoroSlot.model) or not isinstance(entry, dict):
            raise ValueError("unknown_speech_model")
        if model == KokoroSlot.model and ("gpuConfig" in entry) != ("core" in entry):
            raise ValueError("kokoro_cuda_requires_gpu_config_and_core")
        if "legacyPort" in entry:
            ports.append(entry["legacyPort"])
    if any(type(value) is not int or not 1024 <= value <= 65535 for value in ports) or len(set(ports)) != len(ports):
        raise ValueError("invalid_speech_service_ports")
    return config


def reservation_keeper(gpu_config_path):
    """The source-pinned guard, reading the timeline with retries, wrapped in a LeaseKeeper."""
    from replica_gpu_guard import GpuReservationGuard
    gpu = json.loads(Path(gpu_config_path).read_text(encoding="utf-8-sig"))
    return LeaseKeeper(GpuReservationGuard(gpu, fetch=RetryingTimelineFetch(gpu["timelineUrl"])))


def build_slots(config, budget=None):
    """Prepares every configured model; GPU models load later, under a confirmed reservation."""
    budget = budget or CudaAllocatorBudget()
    slots = []
    whisper = config["models"].get(WhisperSlot.model)
    if whisper is not None:
        keeper = reservation_keeper(whisper["gpuConfig"])
        manifest = json.loads(Path(whisper["artifacts"]).read_text())

        def load_whisper():
            import torch
            from transcription_engine import TranscriptionEngine
            with budget.loading(WhisperSlot.model, keeper.config["memoryMiB"], torch):
                return TranscriptionEngine(Path(whisper["modelPath"]), manifest, keeper)

        slots.append(WhisperSlot(loader=load_whisper, keeper=keeper, budget=budget))
    kokoro = config["models"].get(KokoroSlot.model)
    if kokoro is not None and "gpuConfig" in kokoro:
        keeper = reservation_keeper(kokoro["gpuConfig"])

        def load_kokoro_cuda():
            import torch
            return KokoroCudaEngine(Path(kokoro["core"]), keeper, budget, torch)

        slots.append(KokoroCudaSlot(loader=load_kokoro_cuda, keeper=keeper, budget=budget))
    elif kokoro is not None:
        def load_kokoro_cpu():
            from kokoro_engine import SpeechEngine
            return SpeechEngine()

        slots.append(KokoroSlot(loader=load_kokoro_cpu))
    return slots


def main():
    config = load_config(Path(os.environ["MYCELLIOS_SPEECH_SERVICE_CONFIG"]).read_text(encoding="utf-8-sig"))
    slots = build_slots(config)
    start_server(unified_handler(slots), config.get("port", 8895))
    for slot in slots:
        port = config["models"][slot.model].get("legacyPort")
        if port is not None:
            start_server(legacy_handler(slot), port)
    for slot in slots:
        threading.Thread(target=supervise, args=(slot,), daemon=True).start()
    print(json.dumps({"status": "ready", "runtime": RUNTIME, "models": [slot.model for slot in slots]}), flush=True)
    # Models load and unload with their reservations; the service itself stays up.
    threading.Event().wait()


if __name__ == "__main__":
    main()
