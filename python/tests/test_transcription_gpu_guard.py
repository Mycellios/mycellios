import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("gpu_guard", pathlib.Path(__file__).parents[1] / "distributed_runtime/replica_gpu_guard.py")
guard_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard_module)


class ReservationBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.owner = root / "owner.json"
        self.state = root / "state.json"
        self.owner.write_text(json.dumps({"nodeId": "physical-1", "policy": {"modelAllowlist": [],
            "schedule": [{"days": list(range(7)), "startMinuteUtc": 0, "endMinuteUtc": 1440}]}}))
        self.state.write_text(json.dumps({"contributionEnabled": True, "draining": False}))
        self.now = 100000
        self.cfg = {"timelineUrl": "https://www.mycellios.com/public/v1/requested-models/mycellios-whisper-small/timeline",
                    "modelId": "mycellios-whisper-small", "modelDigest": "sha256:" + "a" * 64,
                    "memoryMiB": 2048, "consumerId": "owned-asr", "nodeId": "physical-1",
                    "gpuCoreSourceSha256": "b" * 64, "nativeConfigPath": str(self.owner), "nativeStatePath": str(self.state)}
        self.row = {"id": "reservation-1", "status": "committed", "modelId": self.cfg["modelId"],
                    "expiresAt": self.now + 90000, "stages": [{"nodeId": "physical-1", "memoryMiB": 2048}],
                    "canary": {"consumerId": "owned-asr", "nodeId": "physical-1", "passed": True,
                               "backend": "cuda", "precision": "float32", "modelDigest": self.cfg["modelDigest"],
                               "gpuCoreSourceSha256": self.cfg["gpuCoreSourceSha256"]}}

    def tearDown(self):
        self.temp.cleanup()

    def make(self, rows=None):
        return guard_module.GpuReservationGuard(self.cfg, fetch=lambda: {"data": {"reservations": rows if rows is not None else [self.row]}}, clock=lambda: self.now)

    def test_committed_physical_owner_and_source(self):
        self.assertEqual(self.make().check()["id"], "reservation-1")

    def test_pause_revokes_even_a_cached_reservation(self):
        guard = self.make()
        guard.check()
        self.state.write_text(json.dumps({"contributionEnabled": False, "draining": False}))
        with self.assertRaisesRegex(ValueError, "owner_paused"):
            guard.check()

    def test_source_and_physical_node_must_match(self):
        for patch in [{"gpuCoreSourceSha256": "c" * 64}, {"nodeId": "other-node"}, {"backend": "cpu"}]:
            row = copy.deepcopy(self.row)
            row["canary"].update(patch)
            with self.assertRaises(ValueError):
                self.make([row]).check()

    def test_prepared_duplicate_or_expired_leases_cannot_serve(self):
        for rows in [[{**self.row, "status": "prepared"}], [self.row, self.row], [{**self.row, "expiresAt": self.now}]]:
            with self.assertRaises(ValueError):
                self.make(rows).check()

    def test_owner_model_policy_is_preserved(self):
        owner = json.loads(self.owner.read_text())
        owner["policy"]["modelAllowlist"] = ["different-model"]
        self.owner.write_text(json.dumps(owner))
        with self.assertRaisesRegex(ValueError, "model_not_allowed"):
            self.make().check()


if __name__ == "__main__":
    unittest.main()
