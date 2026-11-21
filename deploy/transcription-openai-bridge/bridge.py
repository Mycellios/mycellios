"""OpenAI-compatible speech-to-text bridge onto Mycellios network transcription.

Accepts `POST /v1/audio/transcriptions` (multipart `file`, optional `language`
and `response_format`), converts any audio ffmpeg can read to canonical mono
16 kHz PCM, cuts it into segments of at most 24 s, and transcribes each
segment with `mycellios-whisper-small` through the public coordinator API
(`/v1/chat/completions` with the `mycellios-transcription-input/1` envelope),
funded by contribution credits. The caller's bearer key is forwarded and never
stored. Only explicit pre-dispatch refusals (429 concurrency, 503 no capacity)
are retried; any other failure is returned without replaying paid work.
"""
import argparse
import base64
import hashlib
import json
import os
import struct
import subprocess
import time
import urllib.error
import urllib.request
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "mycellios-whisper-small"
SAMPLE_RATE = 16_000
# The coordinator keeps its default 1 MiB request body limit; 24 s of PCM
# (768,044 WAV bytes) stays below it after base64 and the JSON envelope.
SEGMENT_SECONDS = 24.0
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
RETRYABLE = {429, 503}


def wav_bytes(pcm):
    """Canonical RIFF header for mono 16 kHz signed 16-bit PCM."""
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack(
        "<IHHIIHH", 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm))
    return header + pcm


def split_pcm(pcm, seconds=SEGMENT_SECONDS, minimum_seconds=0.25):
    step = int(seconds * SAMPLE_RATE) * 2
    pieces = [pcm[i:i + step] for i in range(0, len(pcm), step)]
    # A trailing sliver carries no speech worth a paid call.
    return [p for p in pieces if len(p) >= int(minimum_seconds * SAMPLE_RATE) * 2]


def envelope(wav, language):
    return json.dumps({"schema": "mycellios-transcription-input/1",
                       "audio": {"format": "wav", "sha256": hashlib.sha256(wav).hexdigest(),
                                 "data": base64.b64encode(wav).decode()},
                       "language": language}, separators=(",", ":"))


def normalize_language(value):
    value = (value or "").strip().lower()[:2]
    return value if value in ("es", "en") else "auto"


def decode_audio(raw, ffmpeg="ffmpeg", timeout=600):
    result = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1",
                             "-ar", str(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"],
                            input=raw, capture_output=True, timeout=timeout, check=False)
    if result.returncode != 0 or not result.stdout:
        raise BridgeError(400, "audio_decode_failed")
    return result.stdout


class BridgeError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


def parse_multipart(content_type, body):
    message = BytesParser(policy=HTTP).parsebytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body)
    if not message.is_multipart():
        raise BridgeError(400, "multipart_required")
    fields, upload = {}, None
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name == "file":
            upload = part.get_payload(decode=True)
            # Keep the client's name: format detection in fallback providers needs its extension.
            fields["_filename"] = os.path.basename(part.get_filename() or "audio.webm")
        elif name:
            fields[name] = part.get_content().strip() if part.get_content_maintype() == "text" else ""
    if not upload:
        raise BridgeError(400, "file_required")
    return upload, fields


class Upstream:
    def __init__(self, base_url, deadline_seconds=900, sleep=time.sleep, opener=urllib.request.urlopen):
        self.base_url = base_url.rstrip("/")
        self.deadline_seconds = deadline_seconds
        self.sleep = sleep
        self.opener = opener

    def transcribe(self, wav, language, authorization):
        # Transcription bills recognized text, never generated tokens. Without a
        # tiny max_tokens the scheduler's SLO estimate (configured 1 token/s)
        # rejects every replica with candidate_slo_exceeded.
        body = json.dumps({"model": MODEL, "max_tokens": 1, "deadline_ms": 60_000, "stream": False,
                           "messages": [{"role": "user", "content": envelope(wav, language)}]}).encode()
        deadline = time.monotonic() + self.deadline_seconds
        delay = 2.0
        while True:
            request = urllib.request.Request(self.base_url + "/v1/chat/completions", data=body, method="POST", headers={
                "Authorization": authorization, "Content-Type": "application/json",
                "x-mycellios-funding": "contribution-credits", "User-Agent": "mycellios-openai-transcription-bridge/1"})
            try:
                with self.opener(request, timeout=300) as response:
                    payload = json.loads(response.read())
                content = json.loads(payload["choices"][0]["message"]["content"])
                if content.get("schema") != "mycellios-transcription/1" or content.get("model") != MODEL:
                    raise BridgeError(502, "invalid_upstream_result")
                return content["text"].strip(), content.get("language")
            except urllib.error.HTTPError as error:
                if error.code not in RETRYABLE or time.monotonic() + delay > deadline:
                    raise BridgeError(error.code if error.code in (401, 402, 403, 429, 503) else 502,
                                      f"upstream_http_{error.code}") from error
                self.sleep(delay)
                delay = min(30.0, delay * 2)
            except (KeyError, IndexError, ValueError) as error:
                raise BridgeError(502, "invalid_upstream_result") from error


def transcribe_upload(raw, language, authorization, upstream, decode=decode_audio):
    pcm = decode(raw)
    texts, detected = [], None
    for piece in split_pcm(pcm):
        text, piece_language = upstream.transcribe(wav_bytes(piece), language, authorization)
        detected = detected or piece_language
        if text:
            texts.append(text)
    return " ".join(texts), detected, len(pcm) / (SAMPLE_RATE * 2)


class Fallback:
    """Optional OpenAI-compatible provider used only when the network cannot transcribe."""

    def __init__(self, base_url, model, key, opener=urllib.request.urlopen):
        self.base_url, self.model, self.key, self.opener = base_url.rstrip("/"), model, key, opener

    def transcribe(self, upload, filename, language):
        boundary = hashlib.sha256(upload[:4096] + str(time.time()).encode()).hexdigest()[:32]
        fields = {"model": self.model, "response_format": "json"}
        if language != "auto":
            fields["language"] = language
        crlf = "\r\n"
        body = b"".join(f'--{boundary}{crlf}Content-Disposition: form-data; name="{k}"{crlf}{crlf}{v}{crlf}'.encode()
                        for k, v in fields.items())
        body += (f'--{boundary}{crlf}Content-Disposition: form-data; name="file"; filename="{filename}"{crlf}'
                 f"Content-Type: application/octet-stream{crlf}{crlf}").encode()
        body += upload + f"{crlf}--{boundary}--{crlf}".encode()
        request = urllib.request.Request(self.base_url + "/audio/transcriptions", data=body, method="POST", headers={
            "Authorization": "Bearer " + self.key, "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "mycellios-openai-transcription-bridge/1"})
        try:
            with self.opener(request, timeout=600) as response:
                return json.loads(response.read())["text"].strip()
        except (urllib.error.URLError, KeyError, ValueError) as error:
            raise BridgeError(502, "fallback_failed") from error


def log_event(**fields):
    print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **fields}), flush=True)


def make_handler(upstream, fallback=None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MycelliosTranscriptionBridge/1"

        def log_message(self, *args):
            return

        provider = None

        def reply(self, status, payload, content_type="application/json"):
            raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            if self.provider:
                self.send_header("x-transcription-provider", self.provider)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path in ("/health", "/v1/models"):
                return self.reply(200, {"object": "list", "data": [{"id": MODEL, "object": "model"}]})
            self.reply(404, {"error": {"code": "not_found"}})

        def do_POST(self):
            try:
                if self.path.rstrip("/") not in ("/v1/audio/transcriptions", "/audio/transcriptions"):
                    raise BridgeError(404, "not_found")
                authorization = self.headers.get("Authorization", "")
                if not authorization.startswith("Bearer ") or len(authorization) < 20:
                    raise BridgeError(401, "bearer_key_required")
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_UPLOAD_BYTES:
                    raise BridgeError(413, "invalid_upload_size")
                body = self.rfile.read(length)
                upload, fields = parse_multipart(self.headers.get("Content-Type", ""), body)
                language = normalize_language(fields.get("language"))
                provider = "mycellios"
                try:
                    text, detected, seconds = transcribe_upload(upload, language, authorization, upstream)
                except BridgeError as error:
                    # Bad audio or a bad key is the caller's problem; anything
                    # else is a network outage the fallback may cover.
                    if fallback is None or error.status in (400, 401, 413):
                        log_event(event="transcription_failed", code=error.code)
                        raise
                    log_event(event="transcription_fallback", code=error.code)
                    text, detected, seconds = fallback.transcribe(upload, fields.get("_filename", "audio.webm"), language), None, None
                    provider = "fallback"
                log_event(event="transcription_served", provider=provider, seconds=seconds)
                self.provider = provider
                if fields.get("response_format") == "text":
                    return self.reply(200, text.encode(), "text/plain; charset=utf-8")
                payload = {"text": text}
                if fields.get("response_format") == "verbose_json":
                    payload.update({"language": detected, "duration": round(seconds, 2)})
                self.reply(200, payload)
            except BridgeError as error:
                self.reply(error.status, {"error": {"code": error.code, "message": error.code}})
            except Exception:
                self.reply(500, {"error": {"code": "internal_error", "message": "internal_error"}})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--upstream", default=os.environ.get("MYCELLIOS_API_URL", "https://www.mycellios.com"))
    args = parser.parse_args()
    fallback = None
    if os.environ.get("FALLBACK_BASE_URL") and os.environ.get("FALLBACK_KEY_FILE"):
        with open(os.environ["FALLBACK_KEY_FILE"], encoding="utf-8") as handle:
            key = handle.read().strip()
        fallback = Fallback(os.environ["FALLBACK_BASE_URL"], os.environ.get("FALLBACK_MODEL", "groq/whisper-large-v3"), key)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(Upstream(args.upstream), fallback))
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
