"""Check allocation policy from production source without GPU dependencies."""
import ast
from pathlib import Path
import unittest


class ArenaCapacityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(__file__).resolve().parents[1] / "distributed_runtime/kv_arena.py"
        module = ast.parse(source.read_text(encoding="utf-8"))
        function = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == "arena_target_tokens")
        namespace = {"MINIMUM_ARENA_TOKENS": 64, "GPU_ARENA_GROWTH_TOKENS": 256}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        cls.target = staticmethod(namespace["arena_target_tokens"])

    def test_gpu_slack_remains_bounded_across_long_context(self):
        capacity = 0
        for needed in range(1, 16385):
            capacity = self.target(capacity, needed, exact=False, gpu=True)
            self.assertGreaterEqual(capacity, needed)
            self.assertLess(capacity - needed, 256)
        self.assertEqual(self.target(4096, 4097, exact=False, gpu=True), 4352)

    def test_cpu_keeps_doubling(self):
        self.assertEqual(self.target(4096, 4097, exact=False, gpu=False), 8192)
        self.assertEqual(self.target(0, 1, exact=False, gpu=False), 64)

    def test_exact_batch_allocations_remain_exact(self):
        for gpu in [False, True]:
            self.assertEqual(self.target(0, 4097, exact=True, gpu=gpu), 4097)

    def test_existing_capacity_is_retained(self):
        self.assertEqual(self.target(8192, 100, exact=False, gpu=True), 8192)


if __name__ == "__main__":
    unittest.main()
