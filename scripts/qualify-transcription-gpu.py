"""Private six-sample qualification under one existing prepared native GPU lease.

This command opens no listener and cannot accept public inference. A failed or
expired preparation is never promoted to a committed serving reservation.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import sys
import time
import unicodedata

parser = argparse.ArgumentParser()
parser.add_argument("--root", required=True)
parser.add_argument("--config", required=True)
args = parser.parse_args()
root = pathlib.Path(args.root).resolve()
cfg = json.loads(pathlib.Path(args.config).read_text(encoding="utf-8-sig"))
sys.path.insert(0, str(root))
from replica_gpu_guard import GpuReservationGuard
from transcription_engine import TranscriptionEngine


class PreparedQualificationGuard(GpuReservationGuard):
    def check(self, force=False):
        now = self.clock()
        self.owner_check(now)
        rows = self.fetch()["data"]["reservations"]
        matches = [r for r in rows if r["id"] == cfg["qualificationReservationId"]]
        if len(matches) != 1:
            raise ValueError("qualification_reservation_missing")
        r = matches[0]
        if (r["status"] != "prepared" or r["modelId"] != cfg["modelId"]
            or not now + 20000 < r["expiresAt"] <= now + 185000 or len(r["stages"]) != 1
            or r["stages"][0]["nodeId"] != cfg["nodeId"] or r["stages"][0]["memoryMiB"] != 2048):
            raise ValueError("qualification_reservation_invalid")
        return r


source = root / "transcription_engine.py"
source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
if source_sha != cfg["gpuCoreSourceSha256"]:
    raise ValueError("qualification_source_changed")
guard = PreparedQualificationGuard(cfg)
guard.check(force=True)
manifest = json.loads((root / "transcription-artifacts.json").read_text())
engine = TranscriptionEngine(root / "model", manifest, guard)
if engine.device_name != cfg["deviceName"]:
    raise ValueError("qualification_device_changed")
rows = []
def normalized(text):
    return " ".join("".join(c if c.isalnum() else " " for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c)).split()).replace("nueve", "9").replace("nine", "9")


for language, expected in [("es", "buenos dias la reunion empieza manana a las 9"), ("en", "the meeting starts at 9 tomorrow morning")]:
    audio = (root / ("canary-" + language + ".wav")).read_bytes()
    sha = hashlib.sha256(audio).hexdigest()
    if sha != cfg["qualificationAudioSha256"][language]:
        raise ValueError("qualification_audio_changed")
    for sample_index in range(3):
        started = time.monotonic()
        guard.check(force=True)
        requested_language = "auto" if sample_index == 2 else language
        result = engine.transcribe({"schema": "mycellios-transcription-input/1", "language": requested_language,
            "audio": {"format": "wav", "sha256": sha, "data": base64.b64encode(audio).decode()}})
        body = json.loads(result["content"])
        (root / "last-qualification-transcript.json").write_text(json.dumps({"language": language, "text": body["text"]}), encoding="utf8")
        if normalized(body["text"]) != expected or body["language"] != language:
            raise ValueError("qualification_transcription_mismatch")
        rows.append({"language": language, "requestedLanguage": requested_language, "elapsedMs": round((time.monotonic() - started) * 1000),
                     "audioSha256": sha, "textSha256": hashlib.sha256(body["text"].encode()).hexdigest(),
                     "expectedPhraseMatched": True, "inputTokens": body["usage"]["input_tokens"]})
guard.check(force=True)
import torch
proof = {"backend": "cuda", "dtype": "float32", "tf32": False, "device": engine.device_name,
         "sourceSha256": source_sha, "modelDigest": engine.digest, "reservationId": cfg["qualificationReservationId"],
         "peakAllocatedBytes": torch.cuda.max_memory_allocated(), "rows": rows}
path = root / "private-qualification.json"
path.write_text(json.dumps(proof, indent=2), encoding="utf8")
print(json.dumps({"passed": True, "samples": len(rows), "peakAllocatedBytes": proof["peakAllocatedBytes"]}))
