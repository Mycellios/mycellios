import base64
import hashlib
import importlib.util
import io
import pathlib
import unittest
import wave

spec = importlib.util.spec_from_file_location("transcription", pathlib.Path(__file__).parents[1] / "distributed_runtime/transcription_engine.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class AudioBoundaries(unittest.TestCase):
    def audio(self):
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x01\x00" * 1600)
        raw = out.getvalue()
        return {"schema": "mycellios-transcription-input/1", "language": "es", "audio": {
            "format": "wav", "sha256": hashlib.sha256(raw).hexdigest(), "data": base64.b64encode(raw).decode()}}

    def test_valid_pcm(self):
        self.assertEqual(len(engine.decode_request(self.audio())), 3244)

    def test_no_remote_urls_or_extra_fields(self):
        body = self.audio()
        body["url"] = "https://example.com/audio.wav"
        with self.assertRaises(ValueError):
            engine.decode_request(body)

    def test_tampered_hash_and_header(self):
        for offset in [4, 20, 22, 24, 28, 32, 34, 40]:
            body = self.audio()
            raw = bytearray(base64.b64decode(body["audio"]["data"]))
            raw[offset] ^= 1
            body["audio"]["data"] = base64.b64encode(raw).decode()
            body["audio"]["sha256"] = hashlib.sha256(raw).hexdigest()
            with self.assertRaises(ValueError):
                engine.decode_request(body)

    def test_no_unknown_language(self):
        body = self.audio()
        body["language"] = "unsupported"
        with self.assertRaises(ValueError):
            engine.decode_request(body)


if __name__ == "__main__":
    unittest.main()
