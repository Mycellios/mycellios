import hashlib
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from distributed_runtime import qwen06_embedding_service as service

TOKEN = "t" * 40


class FakeEmbedder:
    def __init__(self):
        self.closed = False
        self.seen = []

    def embed(self, texts, before_batch=None):
        if before_batch is not None:
            before_batch()
        self.seen.append(texts)
        return [[1.0] + [0.0] * (service.DIMENSIONS - 1) for _ in texts], 7 * len(texts)

    def close(self):
        self.closed = True


class FakeGate:
    def __init__(self, value):
        self.value = value

    def committed(self):
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


CONFIG = {"revision": "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3", "device": "cuda"}


class ReplicaTests(unittest.TestCase):
    def test_gpu_replica_loads_only_while_reservation_is_committed(self):
        gate = FakeGate(False)
        loaded = []
        replica = service.Replica(CONFIG, load=lambda: loaded.append(FakeEmbedder()) or loaded[-1], gate=gate)
        replica.reconcile()
        self.assertEqual(replica.state, "waiting_reservation")
        with self.assertRaises(service.ServiceError) as raised:
            replica.embed(["x"])
        self.assertEqual(raised.exception.status, 503)
        gate.value = True
        replica.reconcile()
        self.assertEqual(replica.state, "ready")
        self.assertEqual(len(replica.embed(["a", "b"])[0]), 2)
        gate.value = RuntimeError("timeline down")
        replica.reconcile()
        self.assertTrue(loaded[0].closed)
        self.assertEqual(replica.state, "waiting_reservation")

    def test_cpu_replica_needs_no_reservation(self):
        replica = service.Replica({**CONFIG, "device": "cpu"}, load=FakeEmbedder)
        replica.reconcile()
        self.assertEqual(replica.state, "ready")

    def test_vectors_that_are_not_unit_length_never_reach_the_caller(self):
        # A faulted GPU backend once returned all-zero rows with status 200.
        for bad in ([0.0] * service.DIMENSIONS, [float("nan")] + [0.0] * (service.DIMENSIONS - 1),
                    [2.0] + [0.0] * (service.DIMENSIONS - 1), [1.0] * 3):
            embedder = FakeEmbedder()
            embedder.embed = lambda texts, before_batch=None, bad=bad: ([bad for _ in texts], 1)
            replica = service.Replica({**CONFIG, "device": "cpu"}, load=lambda embedder=embedder: embedder)
            replica.reconcile()
            with self.assertRaises(service.ServiceError) as raised:
                replica.embed(["x"])
            self.assertEqual((raised.exception.status, raised.exception.code), (500, "invalid_model_output"))

    def test_unit_vectors_pass_the_norm_check(self):
        third = 1 / 3 ** 0.5
        self.assertTrue(service.is_unit_vector([third] * 3 + [0.0] * (service.DIMENSIONS - 3)))


class CancellationTests(unittest.TestCase):
    def test_abandoned_request_stops_between_micro_batches(self):
        replica = service.Replica({**CONFIG, "device": "cpu"}, load=FakeEmbedder)
        replica.reconcile()
        with self.assertRaises(service.ServiceError) as raised:
            replica.embed(["a"], cancelled=lambda: True)
        self.assertEqual(raised.exception.code, "client_closed")
        self.assertEqual(len(replica.embed(["a"], cancelled=lambda: False)[0]), 1)

    def test_detects_a_closed_peer(self):
        import socket
        left, right = socket.socketpair()
        self.assertFalse(service.connection_closed(left))
        right.close()
        self.assertTrue(service.connection_closed(left))
        left.close()


class RequestTests(unittest.TestCase):
    def test_query_instruction_is_applied_server_side_only_for_queries(self):
        self.assertEqual(service.validate_request({"input": ["hola"]}), ["hola"])
        query = service.validate_request({"input": "hola", "input_type": "query"})
        self.assertTrue(query[0].startswith("Instruct: ") and query[0].endswith("Query: hola"))

    def test_rejects_invalid_requests(self):
        for body, status in (({"input": []}, 400), ({"input": [""]}, 400), ({"input": ["x"], "model": "other"}, 400),
                             ({"input": ["x"] * 65}, 413), ({"input": ["x"], "input_type": "code"}, 400)):
            with self.assertRaises(service.ServiceError) as raised:
                service.validate_request(body)
            self.assertEqual(raised.exception.status, status)


class MicroBatchTests(unittest.TestCase):
    def test_long_texts_do_not_inflate_the_whole_batch(self):
        lengths = [150] * 63 + [8192]
        groups = service.plan_micro_batches(lengths, 16_384)
        self.assertEqual(sorted(i for group in groups for i in group), list(range(64)))
        for group in groups:
            self.assertLessEqual(max(lengths[i] for i in group) * len(group), 16_384)
        self.assertIn([63], groups)

    def test_single_text_over_budget_still_runs_alone(self):
        self.assertEqual(service.plan_micro_batches([20_000, 10], 16_384), [[1], [0]])


class ThermalGuardTests(unittest.TestCase):
    def test_pauses_above_limit_and_resumes_with_hysteresis(self):
        readings = iter([80, 79, 74, 71])
        sleeps = []
        guard = service.ThermalGuard(lambda: next(readings), pause_c=78, resume_c=72, sleep=sleeps.append)
        guard.wait()
        self.assertEqual(len(sleeps), 3)
        self.assertFalse(guard.paused)

    def test_gives_up_with_503_while_still_hot(self):
        guard = service.ThermalGuard(lambda: 90, max_wait_s=4, sleep=lambda s: None)
        with self.assertRaises(service.ServiceError) as raised:
            guard.wait()
        self.assertEqual((raised.exception.status, raised.exception.code), (503, "replica_cooling_down"))

    def test_rests_briefly_in_the_soft_band(self):
        sleeps = []
        service.ThermalGuard(lambda: 75, pause_c=78, sleep=sleeps.append).wait()
        self.assertEqual(sleeps, [0.5])
        sleeps.clear()
        service.ThermalGuard(lambda: 60, pause_c=78, sleep=sleeps.append).wait()
        self.assertEqual(sleeps, [])

    def test_observe_tracks_hysteresis_without_sleeping(self):
        readings = iter([80, 77, 71])
        guard = service.ThermalGuard(lambda: next(readings), pause_c=78, resume_c=72)
        guard.observe()
        self.assertTrue(guard.paused)
        guard.observe()
        self.assertTrue(guard.paused)
        guard.observe()
        self.assertFalse(guard.paused)

    def test_wait_accepts_a_longer_limit_for_started_requests(self):
        readings = iter([90, 90, 90, 70])
        sleeps = []
        guard = service.ThermalGuard(lambda: next(readings), pause_c=78, resume_c=72, max_wait_s=2, sleep=sleeps.append)
        guard.wait(max_wait_s=120)
        self.assertEqual(len(sleeps), 3)

    def test_unreadable_temperature_does_not_block(self):
        def broken():
            raise OSError("no nvidia-smi")
        service.ThermalGuard(broken).wait()


class ReservationGateTests(unittest.TestCase):
    cfg = {"timelineUrl": "https://www.mycellios.com/public/v1/requested-models/m-q06/timeline", "modelId": "m-q06",
           "consumerId": "c1", "nodeId": "n1", "memoryMiB": 1024}

    def row(self, **overrides):
        row = {"status": "committed", "modelId": "m-q06", "expiresAt": 100_000,
               "stages": [{"nodeId": "n1", "memoryMiB": 1024}], "canary": {"consumerId": "c1", "passed": True}}
        row.update(overrides)
        return row

    def gate(self, rows):
        return service.ReservationGate(self.cfg, fetch=lambda: {"data": {"reservations": rows}}, clock=lambda: 50_000)

    def test_accepts_only_a_live_committed_reservation_for_this_consumer(self):
        self.assertTrue(self.gate([self.row()]).committed())
        self.assertFalse(self.gate([self.row(status="released")]).committed())
        self.assertFalse(self.gate([self.row(expiresAt=60_000)]).committed())
        self.assertFalse(self.gate([self.row(canary={"consumerId": "other", "passed": True})]).committed())
        self.assertFalse(self.gate([self.row(stages=[{"nodeId": "n2", "memoryMiB": 1024}])]).committed())

    def test_rejects_untrusted_timeline_origin(self):
        with self.assertRaises(ValueError):
            service.ReservationGate({**self.cfg, "timelineUrl": "http://www.mycellios.com/public/v1/requested-models/m-q06/timeline"})


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.replica = service.Replica({**CONFIG, "device": "cpu"}, load=FakeEmbedder)
        self.replica.reconcile()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), service.make_handler(self.replica, TOKEN))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def post(self, body, token=TOKEN):
        request = urllib.request.Request(self.base + "/v1/embeddings", data=json.dumps(body).encode(), method="POST",
                                         headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_serves_openai_shaped_vectors(self):
        status, body = self.post({"model": service.MODEL_ID, "input": ["a", "b"]})
        self.assertEqual(status, 200)
        self.assertEqual([item["index"] for item in body["data"]], [0, 1])
        self.assertEqual(len(body["data"][0]["embedding"]), service.DIMENSIONS)
        self.assertEqual(body["revision"], CONFIG["revision"])
        self.assertEqual(body["usage"]["prompt_tokens"], 14)

    def test_requires_token_and_reports_health_without_auth(self):
        self.assertEqual(self.post({"input": ["a"]}, token="wrong")[0], 401)
        with urllib.request.urlopen(self.base + "/health", timeout=5) as response:
            health = json.loads(response.read())
        self.assertEqual((health["ready"], health["model"]), (True, service.MODEL_ID))



NATIVE_CONFIG = {**CONFIG, "dtype": "float16", "native": {"port": 0, "activationId": "act-qwen06-test"}}
# Pinned in src/contracts/memory-embedding.ts; tests/memory-embedding.test.ts checks the same value.
EXPECTED_IDENTITY = "sha256:7ced807793a552878c586b4fc420c5f9edef134abe30e4202b9f2022487cdd55"


class NativeSettingsTests(unittest.TestCase):
    def test_identity_matches_the_typescript_contract(self):
        self.assertEqual(service.artifact_identity(), EXPECTED_IDENTITY)

    def test_native_listener_is_loopback_pinned_and_approved_only(self):
        self.assertEqual(service.native_settings(NATIVE_CONFIG)["host"], "127.0.0.1")
        self.assertIsNone(service.native_settings(CONFIG))
        cpu = service.native_settings({**NATIVE_CONFIG, "device": "cpu", "dtype": "float32"})
        self.assertEqual(cpu["activationId"], NATIVE_CONFIG["native"]["activationId"])
        for change in ({"native": {**NATIVE_CONFIG["native"], "host": "0.0.0.0"}},
                       {"device": "directml", "dtype": "float16"}, {"device": "cpu", "dtype": "bfloat16"},
                       {"revision": "0" * 40}, {"native": {"port": 0}}):
            with self.assertRaises(ValueError):
                service.native_settings({**NATIVE_CONFIG, **change})

    def test_artifact_hashes_are_checked_before_serving(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "a.bin").write_bytes(b"weights")
            files = {"a.bin": hashlib.sha256(b"weights").hexdigest()}
            self.assertEqual(service.verify_artifact(folder, files), service.artifact_identity(files=files))
            Path(folder, "a.bin").write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                service.verify_artifact(folder, files)


class NativeHttpTests(unittest.TestCase):
    def setUp(self):
        self.replica = service.Replica(NATIVE_CONFIG, load=FakeEmbedder)
        self.replica.reconcile()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), service.make_native_handler(
            self.replica, service.native_settings(NATIVE_CONFIG), "sha256:" + "a" * 64))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, path, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method="GET" if body is None else "POST",
                                         headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def body(self, **changes):
        lease = {"jobId": "job-1", "id": "lease-1", "deadline": int(time.time() * 1000) + 60_000, "activationId": "act-qwen06-test"}
        return {"schema": service.NATIVE_SCHEMA, "input": ["a", "b"], "input_type": "document", "lease": lease, **changes}

    def test_health_reports_identity_activation_and_execution(self):
        status, health = self.call("/health")
        self.assertEqual(status, 200)
        self.assertEqual((health["status"], health["model"], health["upstream_model"]), ("ready", service.NATIVE_MODEL, service.MODEL_ID))
        self.assertEqual((health["activation_id"], health["device"], health["dtype"]), ("act-qwen06-test", "cuda", "float16"))
        self.assertEqual((health["artifact_identity"], health["dimensions"]), ("sha256:" + "a" * 64, service.DIMENSIONS))

    def test_health_is_not_ready_without_a_reservation(self):
        self.replica.gate = FakeGate(False)
        self.replica.reconcile()
        self.assertEqual(self.call("/health")[1]["status"], "waiting_reservation")

    def test_embeds_into_the_native_envelope_with_the_query_instruction(self):
        status, body = self.call("/embed", self.body(input_type="query"))
        self.assertEqual(status, 200)
        self.assertEqual(body["schema"], service.NATIVE_SCHEMA)
        result = body["result"]
        self.assertEqual((result["model"], result["revision"], result["usage"]["prompt_tokens"]), (service.NATIVE_MODEL, CONFIG["revision"], 14))
        self.assertEqual([len(row["embedding"]) for row in result["data"]], [service.DIMENSIONS] * 2)
        self.assertTrue(self.replica.embedder.seen[-1][0].startswith(service.QUERY_INSTRUCTION))

    def test_rejects_stale_or_foreign_leases_and_bad_envelopes(self):
        stale = self.body()
        stale["lease"]["deadline"] = 1
        foreign = self.body()
        foreign["lease"]["activationId"] = "other"
        self.assertEqual(self.call("/embed", stale), (409, {"error": {"code": "lease_invalid"}}))
        self.assertEqual(self.call("/embed", foreign)[0], 409)
        self.assertEqual(self.call("/embed", self.body(schema="mycellios-embeddings/1"))[0], 400)
        self.assertEqual(self.call("/embed", self.body(extra=True))[0], 400)
        self.assertEqual(self.call("/embed", self.body(input="a"))[0], 400)
        self.assertEqual(self.call("/embed", self.body(input=["x" * (service.NATIVE_MAX_TEXT_CHARS + 1)]))[0], 400)
        self.assertEqual(self.call("/embed", self.body(input=["a"] * (service.MAX_INPUTS + 1)))[0], 413)

    def test_refuses_browser_origins(self):
        self.assertEqual(self.call("/health", headers={"Origin": "https://example.com"})[0], 403)
        self.assertEqual(self.call("/embed", self.body(), headers={"Origin": "https://example.com"})[0], 403)

    def test_unit_length_guard_also_protects_the_native_path(self):
        self.replica.embedder.embed = lambda texts, before_batch=None: ([[0.0] * service.DIMENSIONS for _ in texts], 1)
        self.assertEqual(self.call("/embed", self.body()), (500, {"error": {"code": "invalid_model_output"}}))


if __name__ == "__main__":
    unittest.main()
