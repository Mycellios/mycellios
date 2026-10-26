import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).parents[1] / "scripts" / "embedding-gpu-bootstrap.py"
spec = importlib.util.spec_from_file_location("owned_bootstrap", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Kernel:
    def __init__(self, success=True):
        self.calls = []
        self.success = success

    def GetCurrentProcess(self):
        return 123

    def SetPriorityClass(self, process, priority):
        self.calls.append((process, priority))
        return self.success


class PriorityTests(unittest.TestCase):
    def test_only_the_owned_child_changes_priority(self):
        kernel = Kernel()
        module.configure_child_priority(["bootstrap.py", "--config", "private.json"], kernel)
        self.assertEqual(kernel.calls, [])
        module.configure_child_priority(["bootstrap.py", "--child"], kernel)
        self.assertEqual(kernel.calls, [(123, 0x20)])

    def test_priority_failure_stops_before_importing_the_executor(self):
        with self.assertRaisesRegex(RuntimeError, "normal_priority_unavailable"):
            module.configure_child_priority(["--child"], Kernel(False))


if __name__ == "__main__":
    unittest.main()
