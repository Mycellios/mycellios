import base64
import hashlib
import io
import threading
import unittest
import wave
from distributed_runtime.kokoro_engine import SpeechEngine, MAX_AUDIO_BYTES, VOICES

class FakeTokenizer:
    def encode(self, text, **_):
        return list(range(len(text.split())))

class KokoroEngineTests(unittest.TestCase):
    def engine(self, samples=24000):
        import torch
        engine = SpeechEngine.__new__(SpeechEngine)
        engine.voice = VOICES[0]
        engine.voice_tensor = None
        engine.gate = threading.Lock()
        engine.tokenizer = FakeTokenizer()
        engine.pipeline = lambda *_, **__: iter([("", "", torch.ones(samples) / 4)])
        return engine

    def test_serializes_valid_bounded_pcm_and_measures_only_input(self):
        engine = self.engine()
        result = engine.synthesize("Hola Daniel")
        import json
        speech = json.loads(result["content"])
        raw = base64.b64decode(speech["audio"]["data"], validate=True)
        with wave.open(io.BytesIO(raw)) as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 24000))
            self.assertEqual(wav.getnframes(), 24000)
        self.assertEqual(result["input_tokens"], 2)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), speech["audio"]["sha256"])

    def test_rejects_oversized_audio_and_releases_the_runtime(self):
        engine = self.engine(MAX_AUDIO_BYTES)
        with self.assertRaisesRegex(ValueError, "audio_limit"):
            engine.synthesize("Hola")
        self.assertFalse(engine.gate.locked())

    def test_rejects_empty_or_excessive_text(self):
        engine = self.engine()
        for text in ("", " ", "x" * 401, None):
            with self.assertRaises(ValueError):
                engine.synthesize(text)

    def test_refuses_overlapping_inference(self):
        engine = self.engine()
        engine.gate.acquire()
        with self.assertRaises(BlockingIOError):
            engine.synthesize("Hola")
        engine.gate.release()
