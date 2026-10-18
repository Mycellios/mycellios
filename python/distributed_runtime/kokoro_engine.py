"""Optional, bounded CPU speech executor. No cloud inference calls."""
import base64
import hashlib
import io
import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "mycellios-kokoro-es"
REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
WEIGHT_SHA256 = "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4"
MAX_AUDIO_BYTES = 1_048_576
MAX_TEXT = 400
RATE = 24_000
VOICES = ("ef_dora", "em_alex", "em_santa")


class SpeechEngine:
    def __init__(self, voice="ef_dora"):
        if voice not in VOICES:
            raise ValueError("unsupported_spanish_voice")
        import torch
        import tiktoken
        from huggingface_hub import hf_hub_download
        from kokoro import KModel, KPipeline
        torch.set_num_threads(int(os.environ.get("MYCELLIOS_SPEECH_THREADS", "2")))
        self.voice = voice
        self.gate = threading.Lock()
        self.tokenizer = tiktoken.get_encoding("cl100k_base")
        weight = hf_hub_download("hexgrad/Kokoro-82M", "kokoro-v1_0.pth", revision=REVISION)
        config = hf_hub_download("hexgrad/Kokoro-82M", "config.json", revision=REVISION)
        voice_file = hf_hub_download("hexgrad/Kokoro-82M", "voices/" + voice + ".pt", revision=REVISION)
        with open(weight, "rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != WEIGHT_SHA256:
            raise ValueError("kokoro_weight_digest_mismatch")
        model = KModel(config=config, model=weight).to("cpu").eval()
        self.pipeline = KPipeline(lang_code="e", model=model, device="cpu")
        self.voice_tensor = torch.load(voice_file, map_location="cpu", weights_only=True)

    def synthesize(self, text):
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise ValueError("speech_requires_1_to_400_characters")
        if not self.gate.acquire(blocking=False):
            raise BlockingIOError("speech_capacity_exhausted")
        try:
            import numpy as np
            import torch
            segments = []
            samples = 0
            with torch.inference_mode():
                for _, _, audio in self.pipeline(text, voice=self.voice_tensor, speed=1):
                    if audio is None:
                        continue
                    data = audio.detach().cpu().numpy()
                    samples += len(data)
                    if samples * 2 + 44 > MAX_AUDIO_BYTES:
                        raise ValueError("speech_audio_limit_exceeded")
                    segments.append(data)
            if not segments:
                raise ValueError("speech_produced_no_audio")
            pcm = (np.clip(np.concatenate(segments), -1, 1) * 32767).astype("<i2").tobytes()
            output = io.BytesIO()
            with wave.open(output, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(RATE)
                wav.writeframes(pcm)
            raw = output.getvalue()
            envelope = {
                "schema": "mycellios-speech/1", "text": text, "voice": self.voice,
                "audio": {
                    "format": "wav", "sample_rate": RATE,
                    "duration_seconds": samples / RATE,
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "data": base64.b64encode(raw).decode("ascii"),
                },
            }
            return {
                "model": MODEL, "content": json.dumps(envelope, ensure_ascii=False),
                "input_tokens": len(self.tokenizer.encode(text, disallowed_special=())),
                "tokenizer": "cl100k_base",
            }
        finally:
            self.gate.release()


def serve(engine, host="127.0.0.1", port=8890):
    if host not in ("127.0.0.1", "localhost"):
        raise ValueError("speech_runtime_requires_ipv4_loopback")
    class Handler(BaseHTTPRequestHandler):
        timeout = 10
        def log_message(self, *_):
            pass  # Do not log prompts, audio or request bodies.
        def reply(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
        def do_GET(self):
            if self.path != "/health":
                return self.reply(404, {"error": "not_found"})
            return self.reply(200, {
                "status": "ready", "model": MODEL,
                "artifact_identity": "sha256:" + WEIGHT_SHA256,
                "runtime": "mycellios-kokoro/1", "tokenizer": "cl100k_base",
            })
        def do_POST(self):
            if self.path != "/synthesize":
                return self.reply(404, {"error": "not_found"})
            try:
                if self.headers.get("Transfer-Encoding"):
                    raise ValueError("chunked_upload_not_supported")
                size = int(self.headers.get("Content-Length", "0"))
                if size < 1 or size > 4096:
                    raise ValueError("invalid_request_size")
                body = self.rfile.read(size)
                if len(body) != size:
                    raise ValueError("incomplete_request")
                value = json.loads(body)
                if not isinstance(value, dict) or set(value) != {"text"}:
                    raise ValueError("invalid_speech_request")
                return self.reply(200, engine.synthesize(value["text"]))
            except BlockingIOError:
                return self.reply(429, {"error": "speech_capacity_exhausted"})
            except (ValueError, TypeError, UnicodeError):
                return self.reply(400, {"error": "invalid_or_oversized_speech"})
            except Exception:
                return self.reply(503, {"error": "speech_generation_failed"})
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    engine = SpeechEngine(os.environ.get("MYCELLIOS_SPEECH_VOICE", "ef_dora"))
    print(json.dumps({"status": "ready", "model": MODEL}), flush=True)
    serve(engine, port=int(os.environ.get("MYCELLIOS_SPEECH_PORT", "8890")))
