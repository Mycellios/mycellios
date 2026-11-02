"""Exercise the actual local generation method without importing GPU dependencies."""
import ast
from pathlib import Path
import threading
import time
from types import SimpleNamespace
import unittest


class Tensor:
    dtype = "fixture-int"

    def __init__(self, rows, **_kwargs):
        self.values = list(rows[0])
        self.shape = (1, len(self.values))

    def __getitem__(self, indexes):
        return Tensor([self.values[indexes[1]]])


class Cancelled(RuntimeError):
    pass


def generation_method():
    source = Path(__file__).resolve().parents[1] / "distributed_runtime/engine.py"
    module = ast.parse(source.read_text(encoding="utf-8"))
    engine = next(node for node in module.body if isinstance(node, ast.ClassDef) and node.name == "LocalPipelineEngine")
    method = next(node for node in engine.body if isinstance(node, ast.FunctionDef) and node.name == "_generate_one")
    namespace = {
        "GenerationInput": object,
        "GenerationOutput": SimpleNamespace,
        "TokenCallback": object,
        "GenerationCancelledError": Cancelled,
        "time": time,
        "torch": SimpleNamespace(tensor=Tensor),
    }
    exec((source.parent / "prefill.py").read_text(encoding="utf-8"), namespace)
    namespace["GenerationCancelledError"] = Cancelled
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec"), namespace)
    return namespace["_generate_one"]


class Runner:
    def __init__(self, signal, *, cancel=False, fail=False):
        self.signal = signal
        self.cancel = cancel
        self.fail = fail
        self.prefixes = []
        self.projections = []
        self.begun = []
        self.ended = []

    def begin(self, request_id):
        self.begun.append(request_id)

    def end(self, request_id):
        self.ended.append(request_id)

    def forward_ids(self, request_id, tensor):
        self.prefixes.append(tensor.values)
        if self.cancel:
            self.signal.set()
        if self.fail:
            raise RuntimeError("prefill failed")

    def forward_ids_with_tokens(self, request_id, tensor, *, token_mode):
        assert token_mode == "last"
        self.projections.append(tensor.values)
        return None, (7 if len(self.projections) == 1 else 9)


class LocalPrefillTests(unittest.TestCase):
    def exercise(self, chunk, *, cancel=False, fail=False, limit=3):
        signal = threading.Event()
        runner = Runner(signal, cancel=cancel, fail=fail)
        engine = SimpleNamespace(
            _state_lock=threading.Lock(), _cancel={41: signal},
            _runner=runner, config=SimpleNamespace(prefill_chunk_tokens=chunk),
        )
        request = SimpleNamespace(client_id=41, input_ids=Tensor([list(range(1, 8))]), max_new_tokens=limit, eos_token_ids={9})
        callbacks = []
        def run():
            return generation_method()(engine, request, lambda *args: callbacks.append(args[:3]))
        return run, runner, callbacks

    def test_chunks_cover_prompt_once_without_emitting_prefix_tokens(self):
        for chunk in [0, 1, 2, 3, 7, 10]:
            with self.subTest(chunk=chunk):
                run, runner, callbacks = self.exercise(chunk)
                result = run()
                prompt = [value for part in runner.prefixes for value in part] + runner.projections[0]
                self.assertEqual(prompt, list(range(1, 8)))
                if chunk:
                    self.assertTrue(all(len(part) <= chunk for part in runner.prefixes + runner.projections))
                self.assertEqual(runner.projections[1], [7])
                self.assertEqual(result.token_ids, (7, 9))
                self.assertEqual(result.finish_reason, "stop")
                self.assertEqual(callbacks, [(41, 7, 0), (41, 9, 1)])
                self.assertEqual(runner.begun, [41])
                self.assertEqual(runner.ended, [41])

    def test_cancellation_between_prefix_chunks_releases_kv_once(self):
        run, runner, callbacks = self.exercise(2, cancel=True)
        with self.assertRaises(Cancelled):
            run()
        self.assertEqual(runner.prefixes, [[1, 2]])
        self.assertEqual(runner.projections, [])
        self.assertEqual(callbacks, [])
        self.assertEqual(runner.ended, [41])

    def test_prefix_failure_releases_kv_without_emitting_output(self):
        run, runner, callbacks = self.exercise(2, fail=True)
        with self.assertRaisesRegex(RuntimeError, "prefill failed"):
            run()
        self.assertEqual(runner.projections, [])
        self.assertEqual(callbacks, [])
        self.assertEqual(runner.ended, [41])

    def test_output_limit_does_not_count_prompt_chunks(self):
        run, runner, callbacks = self.exercise(2, limit=1)
        result = run()
        self.assertEqual(result.token_ids, (7,))
        self.assertEqual(result.finish_reason, "length")
        self.assertEqual(len(runner.projections), 1)
        self.assertEqual(callbacks, [(41, 7, 0)])
        self.assertEqual(runner.ended, [41])


if __name__ == "__main__":
    unittest.main()
