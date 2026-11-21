"""Private Qwen3-Embedding-0.6B replica for operator memory (Jarvis).

One node serves `POST /v1/embeddings` on its NetBird address with a bearer
token. A GPU replica loads the model only while the coordinator holds a
committed reservation for its consumer (granted by the native replica
placement broker) and unloads it as soon as the reservation disappears, so
the shared GPU budget is never exceeded. A CPU replica needs no reservation.

Contract: specs/memory-embedding-qwen06/spec.md
"""
import argparse
import hmac
import json
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
DIMENSIONS = 1024
MAX_INPUTS = 64
MAX_TOKENS = 8192
MAX_BODY_BYTES = 4 * 1024 * 1024
QUERY_INSTRUCTION = "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: "


MICRO_BATCH_TOKENS = 16_384


def plan_micro_batches(lengths, budget):
    """Group indices, shortest first, so each padded group stays within budget."""
    groups, current, longest = [], [], 0
    for index in sorted(range(len(lengths)), key=lambda i: lengths[i]):
        size = max(1, lengths[index])
        if current and max(longest, size) * (len(current) + 1) > budget:
            groups.append(current)
            current, longest = [], 0
        current.append(index)
        longest = max(longest, size)
    if current:
        groups.append(current)
    return groups


class ServiceError(Exception):
    def __init__(self, status, code, message=""):
        super().__init__(code)
        self.status, self.code, self.message = status, code, message


def validate_request(body):
    if not isinstance(body, dict):
        raise ServiceError(400, "invalid_request")
    if body.get("model", MODEL_ID) != MODEL_ID:
        raise ServiceError(400, "model_not_served")
    inputs = body.get("input")
    if isinstance(inputs, str):
        inputs = [inputs]
    if not isinstance(inputs, list) or not inputs or not all(isinstance(text, str) and text.strip() for text in inputs):
        raise ServiceError(400, "invalid_input")
    if len(inputs) > MAX_INPUTS:
        raise ServiceError(413, "too_many_inputs")
    input_type = body.get("input_type", "document")
    if input_type not in ("document", "query"):
        raise ServiceError(400, "invalid_input_type")
    prefix = QUERY_INSTRUCTION if input_type == "query" else ""
    return [prefix + text for text in inputs]


class ReservationGate:
    """Fail-closed check of a committed coordinator reservation for this consumer."""

    def __init__(self, config, fetch=None, clock=None):
        url = urllib.parse.urlsplit(config["timelineUrl"])
        expected = "/public/v1/requested-models/" + urllib.parse.quote(config["modelId"], safe="") + "/timeline"
        if url.scheme != "https" or not url.hostname or url.path != expected:
            raise ValueError("invalid_reservation_origin")
        self.config = config
        self.fetch = fetch or self._fetch
        self.clock = clock or (lambda: int(time.time() * 1000))

    def _fetch(self):
        request = urllib.request.Request(self.config["timelineUrl"], headers={"User-Agent": "Mycellios-Qwen06-Replica/1"})
        with urllib.request.urlopen(request, timeout=5) as response:
            raw = response.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError("reservation_response_too_large")
        return json.loads(raw)

    def committed(self):
        now = self.clock()
        cfg = self.config
        body = self.fetch()
        rows = (body.get("data") or body).get("reservations") or []
        for row in rows:
            canary = row.get("canary") or {}
            stages = row.get("stages") or []
            expiry = row.get("expiresAt")
            if (row.get("status") == "committed" and row.get("modelId") == cfg["modelId"]
                    and canary.get("consumerId") == cfg["consumerId"] and canary.get("passed") is True
                    and type(expiry) is int and expiry > now + 20_000
                    and len(stages) == 1 and stages[0].get("nodeId") == cfg["nodeId"]
                    and stages[0].get("memoryMiB") == cfg["memoryMiB"]):
                return True
        return False


class TorchEmbedder:
    def __init__(self, path, device, dtype, revision):
        import torch
        from transformers import AutoModel, AutoTokenizer
        self.torch = torch
        self.device = device
        self.revision = revision
        self.tokenizer = AutoTokenizer.from_pretrained(path, padding_side="left")
        torch_dtype = {"float16": torch.float16, "bfloat16": torch.bfloat16, "float32": torch.float32}[dtype]
        self.model = AutoModel.from_pretrained(path, torch_dtype=torch_dtype).to(device).eval()

    def embed(self, texts, before_batch=None):
        torch = self.torch
        lengths = [len(ids) for ids in self.tokenizer(texts, truncation=True, max_length=MAX_TOKENS)["input_ids"]]
        vectors = [None] * len(texts)
        tokens = 0
        # Padding to the longest text makes one long chunk inflate a whole
        # batch; bounded length-sorted micro-batches keep memory and time flat.
        for group in plan_micro_batches(lengths, MICRO_BATCH_TOKENS):
            if before_batch is not None:
                before_batch()
            encoded = self.tokenizer([texts[i] for i in group], padding=True, truncation=True,
                                     max_length=MAX_TOKENS, return_tensors="pt").to(self.device)
            with torch.inference_mode():
                hidden = self.model(**encoded).last_hidden_state[:, -1]
                rows = torch.nn.functional.normalize(hidden.float(), dim=-1).cpu().tolist()
            for index, row in zip(group, rows):
                vectors[index] = row
            tokens += int(encoded["attention_mask"].sum())
        return vectors, tokens

    def close(self):
        del self.model
        if self.device == "cuda":
            self.torch.cuda.empty_cache()


class ThermalGuard:
    """Hysteresis gate below the owner's node temperature limit.

    Sustained backfill can heat a laptop GPU past the node's limit, which
    pauses the whole node and every replica on it. Work waits while the GPU
    is at or above `pause_c` and resumes below `resume_c`; a request that
    cannot start within `max_wait_s` gets 503 so the caller backs off.
    """

    def __init__(self, read_temperature, pause_c=78, resume_c=72, max_wait_s=60, sleep=time.sleep, soft_c=None,
                 soft_pause_s=0.5):
        self.read = read_temperature
        self.pause_c, self.resume_c, self.max_wait_s, self.sleep = pause_c, resume_c, max_wait_s, sleep
        # Between soft_c and pause_c, short rests let the laptop cooler keep up.
        self.soft_c = pause_c - 4 if soft_c is None else soft_c
        self.soft_pause_s = soft_pause_s
        self.paused = False

    def wait(self):
        waited = 0.0
        while True:
            try:
                temperature = self.read()
            except Exception:
                temperature = None
            if temperature is None:
                return
            if self.paused and temperature < self.resume_c:
                self.paused = False
            elif not self.paused and temperature >= self.pause_c:
                self.paused = True
            if not self.paused:
                if temperature >= self.soft_c:
                    self.sleep(self.soft_pause_s)
                return
            if waited >= self.max_wait_s:
                raise ServiceError(503, "replica_cooling_down")
            self.sleep(2.0)
            waited += 2.0


def nvidia_temperature():
    import subprocess
    out = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
                         capture_output=True, text=True, timeout=5, check=True).stdout
    return max(int(line) for line in out.split() if line.strip().isdigit())


class Replica:
    def __init__(self, config, load=None, gate=None, thermal=None):
        self.config = config
        self.thermal = thermal
        self.load = load or (lambda: TorchEmbedder(config["modelPath"], config["device"], config["dtype"], config["revision"]))
        self.gate = gate
        self.embedder = None
        self.state = "starting"
        self.lock = threading.Lock()

    def reconcile(self):
        allowed = True
        if self.gate is not None:
            try:
                allowed = self.gate.committed()
            except Exception:
                allowed = False
        with self.lock:
            if allowed and self.embedder is None:
                self.state = "loading"
                self.embedder = self.load()
            elif not allowed and self.embedder is not None:
                self.embedder.close()
                self.embedder = None
            self.state = "ready" if self.embedder is not None else "waiting_reservation"

    def embed(self, texts):
        before = self.thermal.wait if self.thermal is not None else None
        if before is not None:
            before()
        with self.lock:
            if self.embedder is None:
                raise ServiceError(503, "no_replica_available")
            # Check between micro-batches too: one long request can otherwise
            # run the GPU past the owner's node temperature limit.
            vectors, tokens = (self.embedder.embed(texts, before) if before is not None
                               else self.embedder.embed(texts))
        if len(vectors) != len(texts) or any(len(vector) != DIMENSIONS for vector in vectors):
            raise ServiceError(500, "invalid_model_output")
        return vectors, tokens


def make_handler(replica, token):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MycelliosQwen06/1"

        def log_message(self, *args):
            return

        def reply(self, status, payload):
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path != "/health":
                return self.reply(404, {"error": {"code": "not_found"}})
            self.reply(200, {"ready": replica.state == "ready", "state": replica.state, "model": MODEL_ID,
                             "revision": replica.config["revision"], "device": replica.config["device"]})

        def do_POST(self):
            try:
                if self.path != "/v1/embeddings":
                    raise ServiceError(404, "not_found")
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_BODY_BYTES:
                    self.close_connection = True
                    raise ServiceError(413 if length > MAX_BODY_BYTES else 400, "invalid_body_size")
                # Drain the bounded body first so error replies reach the client.
                raw = self.rfile.read(length)
                supplied = self.headers.get("Authorization", "")
                if not hmac.compare_digest(supplied.encode(), ("Bearer " + token).encode()):
                    raise ServiceError(401, "unauthorized")
                texts = validate_request(json.loads(raw))
                vectors, tokens = replica.embed(texts)
                self.reply(200, {"object": "list", "model": MODEL_ID, "revision": replica.config["revision"],
                                 "data": [{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)],
                                 "usage": {"prompt_tokens": tokens, "total_tokens": tokens}})
            except ServiceError as error:
                self.reply(error.status, {"error": {"code": error.code}})
            except (ValueError, json.JSONDecodeError):
                self.reply(400, {"error": {"code": "invalid_request"}})
            except Exception:
                self.reply(500, {"error": {"code": "internal_error"}})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    config = json.loads(Path(parser.parse_args().config).read_text(encoding="utf-8-sig"))
    token = Path(config["tokenFile"]).read_text(encoding="utf-8").strip()
    if len(token) < 32:
        raise ValueError("token_too_short")
    gate = ReservationGate(config["reservation"]) if config.get("reservation") else None
    thermal = None
    if config["device"] == "cuda":
        limits = config.get("thermal", {})
        thermal = ThermalGuard(nvidia_temperature, limits.get("pauseC", 78), limits.get("resumeC", 72))
    replica = Replica(config, gate=gate, thermal=thermal)

    def loop():
        while True:
            try:
                replica.reconcile()
            except Exception as error:  # keep serving state; loading errors retry
                replica.state = "load_failed:" + type(error).__name__
            time.sleep(10)

    threading.Thread(target=loop, daemon=True).start()
    server = ThreadingHTTPServer((config["host"], int(config["port"])), make_handler(replica, token))
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
