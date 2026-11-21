import base64
import hashlib
import importlib.util
import io
import json
import pathlib
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location("bridge", pathlib.Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def result(text, language="es"):
    content = json.dumps({"schema": "mycellios-transcription/1", "model": bridge.MODEL, "text": text, "language": language})
    return FakeResponse(json.dumps({"choices": [{"message": {"content": content}}]}).encode())


def http_error(code):
    return urllib.error.HTTPError("https://x/v1/chat/completions", code, "err", {}, io.BytesIO(b"{}"))


class WavTests(unittest.TestCase):
    def test_wav_header_matches_the_coordinator_contract(self):
        wav = bridge.wav_bytes(b"\x01\x00" * 16_000)
        self.assertEqual(wav[:4], b"RIFF")
        self.assertEqual(int.from_bytes(wav[4:8], "little"), len(wav) - 8)
        self.assertEqual(wav[8:16], b"WAVEfmt ")
        self.assertEqual(int.from_bytes(wav[24:28], "little"), 16_000)
        self.assertEqual(int.from_bytes(wav[40:44], "little"), len(wav) - 44)
        self.assertLessEqual(len(bridge.wav_bytes(b"\x00" * int(bridge.SEGMENT_SECONDS * 16_000) * 2)), 960_044)

    def test_splits_into_bounded_segments_and_drops_slivers(self):
        pcm = b"\x00\x00" * (16_000 * 61)
        pieces = bridge.split_pcm(pcm)
        self.assertEqual(len(pieces), 3)
        self.assertTrue(all(len(p) <= int(bridge.SEGMENT_SECONDS * 16_000) * 2 for p in pieces))
        self.assertEqual(bridge.split_pcm(b"\x00\x00" * 100), [])

    def test_envelope_binds_audio_hash(self):
        wav = bridge.wav_bytes(b"\x00\x00" * 160)
        payload = json.loads(bridge.envelope(wav, "es"))
        self.assertEqual(payload["schema"], "mycellios-transcription-input/1")
        self.assertEqual(payload["audio"]["sha256"], hashlib.sha256(wav).hexdigest())
        self.assertEqual(base64.b64decode(payload["audio"]["data"]), wav)
        self.assertEqual(bridge.normalize_language("es-ES"), "es")
        self.assertEqual(bridge.normalize_language("fr"), "auto")


class UpstreamTests(unittest.TestCase):
    def test_retries_only_pre_dispatch_refusals(self):
        calls, sleeps = [], []
        responses = [http_error(429), http_error(503), result("hola")]

        def opener(request, timeout):
            calls.append(request)
            item = responses.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        upstream = bridge.Upstream("https://www.mycellios.com", sleep=sleeps.append, opener=opener)
        self.assertEqual(upstream.transcribe(b"wav", "es", "Bearer key"), ("hola", "es"))
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0].get_header("X-mycellios-funding"), "contribution-credits")
        sent = json.loads(calls[0].data)
        self.assertEqual((sent["model"], sent["max_tokens"], sent["stream"]), (bridge.MODEL, 1, False))
        self.assertEqual(sleeps, [2.0, 4.0])

    def test_does_not_replay_other_failures(self):
        calls = []

        def opener(request, timeout):
            calls.append(request)
            raise http_error(500)
        with self.assertRaises(bridge.BridgeError) as raised:
            bridge.Upstream("https://x", sleep=lambda s: None, opener=opener).transcribe(b"w", "auto", "Bearer k")
        self.assertEqual((len(calls), raised.exception.code), (1, "upstream_http_500"))


class MultipartAndFlowTests(unittest.TestCase):
    def test_parses_openai_multipart_and_joins_segments(self):
        boundary = "XyZ"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n"
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nes\r\n"
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.mp3\"\r\n"
                f"Content-Type: audio/mpeg\r\n\r\n").encode() + b"AUDIO\x00\x01" + f"\r\n--{boundary}--\r\n".encode()
        upload, fields = bridge.parse_multipart(f"multipart/form-data; boundary={boundary}", body)
        self.assertEqual(upload, b"AUDIO\x00\x01")
        self.assertEqual((fields["model"], fields["language"], fields["_filename"]), ("whisper-1", "es", "a.mp3"))

        class FakeUpstream:
            def __init__(self):
                self.count = 0

            def transcribe(self, wav, language, authorization):
                self.count += 1
                return f"parte {self.count}", "es"
        text, language, seconds = bridge.transcribe_upload(upload, "es", "Bearer k", FakeUpstream(),
                                                           decode=lambda raw: b"\x00\x00" * (16_000 * 40))
        self.assertEqual((text, language, round(seconds)), ("parte 1 parte 2", "es", 40))


class FallbackTests(unittest.TestCase):
    def test_fallback_posts_openai_multipart_with_its_own_key(self):
        seen = []

        def opener(request, timeout):
            seen.append(request)
            return FakeResponse(json.dumps({"text": " hola "}).encode())
        text = bridge.Fallback("https://omni/api/v1/", "groq/whisper-large-v3", "fk", opener=opener).transcribe(b"AUDIO", "a", "es")
        self.assertEqual(text, "hola")
        self.assertEqual(seen[0].full_url, "https://omni/api/v1/audio/transcriptions")
        self.assertEqual(seen[0].get_header("Authorization"), "Bearer fk")
        self.assertIn(b'name="model"\r\n\r\ngroq/whisper-large-v3', seen[0].data)
        self.assertIn(b'name="language"\r\n\r\nes', seen[0].data)
        self.assertIn(b"AUDIO", seen[0].data)


if __name__ == "__main__":
    unittest.main()
