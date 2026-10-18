"""Optional, bounded CPU speech executor. No cloud inference calls."""
import base64
import hashlib
import io
import json
import math
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
VOICES = ("af_heart", "am_michael", "ef_dora", "em_alex", "em_santa")
VOICE_SHA256 = {
    "af_heart": "0ab5709b8ffab19bfd849cd11d98f75b60af7733253ad0d67b12382a102cb4ff",
    "am_michael": "9a443b79a4b22489a5b0ab7c651a0bcd1a30bef675c28333f06971abbd47bd37",
    "ef_dora": "d9d69b0f8a2b87a345f269d89639f89dfbd1a6c9da0c498ae36dd34afcf35530",
    "em_alex": "5eac53f767c3f31a081918ba531969aea850bed18fe56419b804d642c6973431",
    "em_santa": "aa8620cb96cec705823efca0d956a63e158e09ad41aca934d354b7f0778f63cb",
}



def speech_options(language="en", voice=None, speed=1):
    if language not in ("en", "es"):
        raise ValueError("unsupported_speech_language")
    voice = voice if voice is not None else ("af_heart" if language == "en" else "ef_dora")
    if voice not in VOICES or not voice.startswith("a" if language == "en" else "e"):
        raise ValueError("unsupported_voice_for_language")
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.5 <= speed <= 2:
        raise ValueError("speech_speed_out_of_bounds")
    return language, voice, float(speed)


class SpeechEngine:
    def __init__(self):
        import torch
        import tiktoken
        from huggingface_hub import hf_hub_download
        from kokoro import KModel, KPipeline
        torch.set_num_threads(int(os.environ.get("MYCELLIOS_SPEECH_THREADS", "2")))
        self.gate = threading.Lock()
        self.tokenizer = tiktoken.get_encoding("cl100k_base")
        weight = hf_hub_download("hexgrad/Kokoro-82M", "kokoro-v1_0.pth", revision=REVISION)
        config = hf_hub_download("hexgrad/Kokoro-82M", "config.json", revision=REVISION)
        with open(weight, "rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != WEIGHT_SHA256:
            raise ValueError("kokoro_weight_digest_mismatch")
        model = KModel(config=config, model=weight).to("cpu").eval()
        self.pipelines = {language: KPipeline(lang_code=code, model=model, device="cpu", repo_id="hexgrad/Kokoro-82M")
                          for language, code in (("en", "a"), ("es", "e"))}
        self.voices = {}
        for voice in VOICES:
            voice_file = hf_hub_download("hexgrad/Kokoro-82M", "voices/" + voice + ".pt", revision=REVISION)
            with open(voice_file, "rb") as source:
                if hashlib.file_digest(source, "sha256").hexdigest() != VOICE_SHA256[voice]:
                    raise ValueError("kokoro_voice_digest_mismatch")
            self.voices[voice] = torch.load(voice_file, map_location="cpu", weights_only=True)

    def synthesize(self, text, *, language="en", voice=None, speed=1):
        language, voice, speed = speech_options(language, voice, speed)
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
                for _, _, audio in self.pipelines[language](text, voice=self.voices[voice], speed=speed):
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
                "schema": "mycellios-speech/1", "text": text, "language": language, "voice": voice, "speed": speed,
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
                "runtime": "mycellios-kokoro/2", "tokenizer": "cl100k_base",
                "default_language": "en", "languages": ["en", "es"], "voices": list(VOICES), "speed_range": [0.5, 2],
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
                if not isinstance(value, dict) or "text" not in value or set(value) - {"text", "language", "voice", "speed"}:
                    raise ValueError("invalid_speech_request")
                return self.reply(200, engine.synthesize(**value))
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
    engine = SpeechEngine()
    print(json.dumps({"status": "ready", "model": MODEL}), flush=True)
    serve(engine, port=int(os.environ.get("MYCELLIOS_SPEECH_PORT", "8890")))
