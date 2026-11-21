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


class DispersionTests(unittest.TestCase):
    """specs/node-owner-privacy D3: one recording's segments never share a node."""

    def test_sends_the_group_only_when_given(self):
        sent = []

        def opener(request, timeout):
            sent.append(json.loads(request.data))
            return result("hola")
        upstream = bridge.Upstream("https://x", sleep=lambda s: None, opener=opener)
        upstream.transcribe(b"w", "es", "Bearer k")
        upstream.transcribe(b"w", "es", "Bearer k", "group-0123456789abcdef")
        self.assertNotIn("dispersion", sent[0])
        self.assertEqual(sent[1]["dispersion"], {"group": "group-0123456789abcdef"})

    def test_does_not_wait_when_no_node_is_left(self):
        calls = []

        def opener(request, timeout):
            calls.append(request)
            raise urllib.error.HTTPError("https://x", 503, "err", {},
                                         io.BytesIO(b'{"error":{"code":"dispersion_exhausted"}}'))
        with self.assertRaises(bridge.BridgeError) as raised:
            bridge.Upstream("https://x", sleep=lambda s: None, opener=opener).transcribe(b"w", "es", "Bearer k", "g" * 32)
        self.assertEqual((len(calls), raised.exception.status, raised.exception.code), (1, 503, "dispersion_exhausted"))

    def upstream(self, exhausted_from=None, delays=None):
        import threading
        import time as clock

        class Recording:
            def __init__(self):
                self.groups, self.lock = [], threading.Lock()

            def transcribe(self, wav, language, authorization, group=None):
                with self.lock:
                    self.groups.append(group)
                    index = len(self.groups)
                if delays:
                    clock.sleep(delays.get(wav[44:46], 0))
                if exhausted_from is not None and index >= exhausted_from:
                    raise bridge.BridgeError(503, "dispersion_exhausted")
                return f"part-{wav[44]}", "es"
        return Recording()

    @staticmethod
    def pcm(segments):
        step = int(bridge.SEGMENT_SECONDS * bridge.SAMPLE_RATE) * 2
        return b"".join(bytes([index, 0]) * (step // 2) for index in range(segments))

    def test_fallback_policy_sends_only_exhausted_segments_to_the_provider(self):
        upstream = self.upstream(exhausted_from=2)
        provider = []

        class Provider:
            def transcribe(self, upload, filename, language):
                provider.append((upload[44], filename))
                return f"provider-{upload[44]}"
        text, language, _ = bridge.transcribe_upload(b"raw", "es", "Bearer k", upstream, decode=lambda raw: self.pcm(3),
                                                     policy="fallback", fallback=Provider())
        self.assertEqual(text, "part-0 provider-1 provider-2")
        self.assertEqual(language, "es")
        self.assertEqual(provider, [(1, "segment-1.wav"), (2, "segment-2.wav")])
        self.assertEqual(len(set(upstream.groups)), 1)
        self.assertRegex(upstream.groups[0], r"^[A-Za-z0-9_-]{32}$")

    def test_fail_policy_and_missing_provider_fail_the_upload(self):
        for policy, provider in (("fail", object()), ("fallback", None)):
            with self.assertRaises(bridge.BridgeError) as raised:
                bridge.transcribe_upload(b"raw", "es", "Bearer k", self.upstream(exhausted_from=2),
                                         decode=lambda raw: self.pcm(2), policy=policy, fallback=provider)
            self.assertEqual(raised.exception.code, "dispersion_exhausted")

    def test_each_upload_gets_a_new_group(self):
        upstream = self.upstream()
        for _ in range(2):
            bridge.transcribe_upload(b"raw", "es", "Bearer k", upstream, decode=lambda raw: self.pcm(1), policy="fail")
        self.assertEqual(len(set(upstream.groups)), 2)

    def test_parallel_segments_keep_their_order(self):
        upstream = self.upstream(delays={bytes([0, 0]): 0.2, bytes([1, 0]): 0.1})
        text, _, _ = bridge.transcribe_upload(b"raw", "es", "Bearer k", upstream, decode=lambda raw: self.pcm(3),
                                              policy="fail", parallel=3)
        self.assertEqual(text, "part-0 part-1 part-2")

    def test_off_keeps_the_ungrouped_serial_call(self):
        class ThreeArguments:
            def transcribe(self, wav, language, authorization):
                return "solo", "es"
        text, _, _ = bridge.transcribe_upload(b"raw", "es", "Bearer k", ThreeArguments(), decode=lambda raw: self.pcm(1))
        self.assertEqual(text, "solo")
        with self.assertRaises(ValueError):
            bridge.transcribe_upload(b"raw", "es", "Bearer k", ThreeArguments(), decode=lambda raw: self.pcm(1), policy="x")


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
