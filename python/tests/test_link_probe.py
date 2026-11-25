import socket
import threading
import unittest

from distributed_runtime import link_probe


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class LinkProbeTest(unittest.TestCase):
    def test_measures_round_trips_and_bulk_throughput(self) -> None:
        port = _free_port()
        server = threading.Thread(target=link_probe.serve, args=("127.0.0.1", port, 10.0, 1), daemon=True)
        server.start()
        result = None
        for _ in range(50):
            try:
                result = link_probe.measure("127.0.0.1", port, 20, 0, 1024 * 1024, 5.0)
                break
            except ConnectionRefusedError:
                threading.Event().wait(0.05)
        server.join(timeout=10)
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result["schema"], "mycellios-link-probe/1")
        self.assertEqual(result["samples"], 20)
        self.assertEqual(result["lost"], 0)
        rtt = result["rttMs"]
        self.assertLessEqual(rtt["min"], rtt["p50"])
        self.assertLessEqual(rtt["p50"], rtt["p95"])
        self.assertLessEqual(rtt["p95"], rtt["max"])
        self.assertEqual(result["bulk"]["bytes"], 1024 * 1024)
        self.assertGreater(result["bulk"]["mbitPerSecond"], 0)

    def test_rejects_unbounded_requests(self) -> None:
        with self.assertRaises(ValueError):
            link_probe.measure("127.0.0.1", 1, 0, 0, 0, 1.0)
        with self.assertRaises(ValueError):
            link_probe.measure("127.0.0.1", 1, 1, 0, link_probe.MAX_BULK_BYTES + 1, 1.0)


if __name__ == "__main__":
    unittest.main()
