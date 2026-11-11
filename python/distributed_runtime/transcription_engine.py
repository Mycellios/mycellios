"""Bounded Whisper CUDA replica. No cloud transcription or CPU fallback."""
import array
import base64
import hashlib
import io
import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL = "mycellios-whisper-small"
MAX_BYTES = 960_044
MAX_BODY = 1_300_000


def decode_request(body):
    if not isinstance(body, dict) or set(body) != {"schema", "audio", "language"}:
        raise ValueError("invalid_transcription_request")
    if body["schema"] != "mycellios-transcription-input/1" or body["language"] not in ("es", "en", "auto"):
        raise ValueError("invalid_transcription_request")
    audio = body["audio"]
    if not isinstance(audio, dict) or set(audio) != {"format", "sha256", "data"} or audio["format"] != "wav":
        raise ValueError("invalid_audio")
    raw = base64.b64decode(audio["data"], validate=True)
    if not 46 <= len(raw) <= MAX_BYTES or len(raw) % 2 or hashlib.sha256(raw).hexdigest() != audio["sha256"]:
        raise ValueError("audio_integrity_failed")
    # Accept only the same canonical 44-byte header as the public contract.
    import struct
    if (raw[:4] != b"RIFF" or raw[8:16] != b"WAVEfmt " or raw[36:40] != b"data"
        or struct.unpack_from("<I", raw, 4)[0] != len(raw) - 8
        or struct.unpack_from("<IHHIIHH", raw, 16) != (16, 1, 1, 16000, 32000, 2, 16)
        or struct.unpack_from("<I", raw, 40)[0] != len(raw) - 44):
        raise ValueError("invalid_pcm_header")
    return raw


def checked_artifacts(root, manifest):
    for name, expected in manifest["files"].items():
        if Path(name).name != name:
            raise ValueError("invalid_artifact_name")
        with (root / name).open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != expected:
                raise ValueError("transcription_artifact_changed")


class TranscriptionEngine:
    def __init__(self, root, manifest, guard, gpu_budget_mb=1536):
        import numpy as np
        import torch
        import tiktoken
        from transformers import WhisperProcessor, WhisperForConditionalGeneration
        guard.check(force=True)
        checked_artifacts(root, manifest)
        if manifest["repo"] != "openai/whisper-small" or manifest["revision"] != "973afd24965f72e36ca33b3055d56a652f456b4d":
            raise ValueError("transcription_model_revision_changed")
        self.artifacts_sha256 = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if torch.cuda.device_count() != 1 or not torch.cuda.is_available():
            raise RuntimeError("physical_cuda_required")
        torch.set_num_threads(2)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.cuda.set_per_process_memory_fraction(gpu_budget_mb * 1024**2 / torch.cuda.get_device_properties(0).total_memory)
        self.processor = WhisperProcessor.from_pretrained(str(root), local_files_only=True)
        self.model = WhisperForConditionalGeneration.from_pretrained(str(root), local_files_only=True,
                                                                   use_safetensors=True, torch_dtype=torch.float32).to("cuda").eval()
        if any(p.device.type != "cuda" or p.dtype != torch.float32 for p in self.model.parameters()):
            raise RuntimeError("physical_cuda_float32_required")
        self.tokenizer = tiktoken.get_encoding("cl100k_base")
        self.guard, self.gate = guard, threading.Lock()
        self.digest = "sha256:" + manifest["files"]["model.safetensors"]
        self.device_name = torch.cuda.get_device_name(0)

    def execution(self):
        lease = self.guard.check(force=True)
        return {"deviceType": "gpu", "backend": "cuda", "deviceName": self.device_name,
                "precision": "float32", "fallback": False, "tf32": False,
                "gpuCoreSourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "guardSourceSha256": hashlib.sha256(Path(__file__).with_name("replica_gpu_guard.py").read_bytes()).hexdigest(),
                "artifactsSha256": self.artifacts_sha256,
                "reservation": {"id": lease["id"], "nodeId": self.guard.config["nodeId"],
                    "consumerId": self.guard.config["consumerId"], "memoryMiB": self.guard.config["memoryMiB"],
                    "expiresAt": lease["expiresAt"]}}

    def transcribe(self, body):
        raw = decode_request(body)
        self.guard.check(force=True)
        if not self.gate.acquire(False):
            raise BlockingIOError("transcription_capacity_exhausted")
        try:
            import numpy as np
            import torch
            samples = np.frombuffer(raw, dtype="<i2", offset=44).astype(np.float32) / 32768
            if float(np.max(np.abs(samples))) < 0.0001:
                raise ValueError("no_speech_detected")
            with torch.inference_mode():
                features = self.processor(samples, sampling_rate=16000, return_tensors="pt").input_features.to("cuda")
                language = body["language"]
                if language == "auto":
                    detected = int(self.model.detect_language(input_features=features)[0])
                    allowed = self.model.generation_config.lang_to_id
                    language = next((lang for lang in ("es", "en") if allowed.get("<|" + lang + "|>") == detected), None)
                    if language is None:
                        raise ValueError("unsupported_audio_language")
                tokens = self.model.generate(features, language=language, task="transcribe", max_new_tokens=256,
                                             do_sample=False, num_beams=1, return_timestamps=False,
                                             return_dict_in_generate=True).sequences
                eos = self.model.generation_config.eos_token_id
                if int(tokens[0, -1]) not in (eos if isinstance(eos, list) else [eos]):
                    raise ValueError("incomplete_transcription")
                text = self.processor.batch_decode(tokens, skip_special_tokens=True)[0].strip()
                torch.cuda.synchronize()
            self.guard.check(force=True)
            count = len(self.tokenizer.encode(text))
            if not text or len(text) > 8192 or not 1 <= count <= 1024:
                raise ValueError("no_valid_transcript")
            envelope = {"schema": "mycellios-transcription/1", "model": MODEL, "audio_sha256": body["audio"]["sha256"],
                        "language": language, "requested_language": body["language"], "text": text,
                        "usage": {"input_tokens": count, "output_tokens": 0, "tokenizer": "cl100k_base"}}
            return {"model": MODEL, "content": json.dumps(envelope, ensure_ascii=False, separators=(",", ":")),
                    "input_tokens": count, "tokenizer": "cl100k_base"}
        finally:
            self.gate.release()


def serve(engine, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log audio or recognized text.

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/health":
                return self.reply(404, {"error": "not_found"})
            try:
                self.reply(200, {"status": "ready", "model": MODEL, "artifact_identity": engine.digest,
                                 "runtime": "mycellios-transcription-runtime/1", "tokenizer": "cl100k_base",
                                 "execution": engine.execution()})
            except Exception:
                self.reply(503, {"error": "transcription_unavailable"})

        def do_POST(self):
            if self.path != "/transcribe":
                return self.reply(404, {"error": "not_found"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 1 <= size <= MAX_BODY or self.headers.get("Content-Type") != "application/json":
                    return self.reply(413, {"error": "invalid_audio_request"})
                self.connection.settimeout(5)
                data = self.rfile.read(size)
                if len(data) != size:
                    raise ValueError("incomplete_request")
                self.reply(200, engine.transcribe(json.loads(data)))
            except BlockingIOError:
                self.reply(429, {"error": "transcription_busy"})
            except ValueError:
                self.reply(422, {"error": "invalid_audio_or_transcript"})
            except Exception:
                self.reply(503, {"error": "transcription_unavailable"})
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    # Provisioning supplies a source-verified native reservation guard and offline model cache.
    from replica_gpu_guard import GpuReservationGuard
    config = json.loads(Path(os.environ["MYCELLIOS_TRANSCRIPTION_GPU_CONFIG"]).read_text(encoding="utf-8-sig"))
    manifest = json.loads(Path(os.environ["MYCELLIOS_TRANSCRIPTION_ARTIFACTS"]).read_text())
    guard = GpuReservationGuard(config)
    engine = TranscriptionEngine(Path(os.environ["MYCELLIOS_TRANSCRIPTION_MODEL_PATH"]), manifest, guard)

    def monitor():
        while True:
            time.sleep(5)
            try:
                guard.check(force=True)
            except Exception:
                os._exit(1)
    threading.Thread(target=monitor, daemon=True).start()
    serve(engine, 8892)
