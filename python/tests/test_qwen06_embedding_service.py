import json
import threading
import unittest
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


if __name__ == "__main__":
    unittest.main()
