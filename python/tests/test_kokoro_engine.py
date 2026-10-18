import base64
import hashlib
import io
import threading
import unittest
import wave
from distributed_runtime.kokoro_engine import SpeechEngine, MAX_AUDIO_BYTES, VOICES, speech_options

class FakeTokenizer:
    def encode(self, text, **_):
        return list(range(len(text.split())))

class KokoroEngineTests(unittest.TestCase):
    def engine(self, samples=24000):
        import torch
        engine = SpeechEngine.__new__(SpeechEngine)
        engine.voices = {voice: None for voice in VOICES}
        engine.gate = threading.Lock()
        engine.tokenizer = FakeTokenizer()
        engine.pipelines = {lang: lambda *_, speed=1, **__: iter([("", "", torch.ones(round(samples / speed)) / 4)]) for lang in ("en", "es")}
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

    def test_defaults_and_bilingual_voices(self):
        import json
        self.assertEqual(speech_options(), ("en", "af_heart", 1.0))
        for language, voice in (("en", "am_michael"), ("es", "ef_dora"), ("es", "em_santa")):
            result = json.loads(self.engine().synthesize("Sample text", language=language, voice=voice)["content"])
            self.assertEqual((result["language"], result["voice"]), (language, voice))

    def test_speed_changes_audio_duration_without_changing_text_usage(self):
        import json
        slow = self.engine().synthesize("Same sample text", speed=0.8)
        fast = self.engine().synthesize("Same sample text", speed=1.2)
        self.assertGreater(json.loads(slow["content"])["audio"]["duration_seconds"], json.loads(fast["content"])["audio"]["duration_seconds"])
        self.assertEqual(slow["input_tokens"], fast["input_tokens"])

    def test_invalid_options_fail_before_inference(self):
        for options in ({"language": "fr"}, {"language": "es", "voice": "af_heart"}, {"voice": "../../bad"}, {"speed": 0}, {"speed": 2.1}, {"speed": float("nan")}, {"speed": True}, {"speed": "1"}):
            with self.assertRaises(ValueError):
                self.engine().synthesize("Sample", **options)
