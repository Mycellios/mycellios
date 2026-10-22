import copy
import importlib.util
import io
import struct
import tempfile
import unittest
from pathlib import Path
import sys

path = Path(__file__).resolve().parents[1] / 'distributed_runtime' / 'decision_graph.py'
spec = importlib.util.spec_from_file_location('decision_graph', path)
graph_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = graph_module
spec.loader.exec_module(graph_module)


def fixture():
    tensors = {str(i): {'id': i, 'name': 't' + str(i), 'type': 0,
                        'ne': [{'type': 'static', 'val': 1}] * 4,
                        'storage': 1 if i == 1 else 0 if i in (0, 2) else 3}
               for i in range(6)}
    return {'name': 'test', 'inputs': [0, 2], 'outputs': [5], 'parameters': [1],
            'symbol_table': [], 'tensors': tensors, 'nodes': [
                {'id': 10, 'inputs': [0, 1], 'outputs': [3]},
                {'id': 11, 'inputs': [3, 2], 'outputs': [4]},
                {'id': 12, 'inputs': [4, 3], 'outputs': [5]}]}


class DecisionGraphTests(unittest.TestCase):
    def test_live_skip_connection_survives_cut(self):
        a, b = graph_module.partition_graph(fixture(), [2])
        self.assertEqual(a['outputs'], [3, 4])
        self.assertEqual(b['inputs'], [3, 4])
        self.assertEqual(b['outputs'], [5])

    def test_original_input_is_available_at_later_stage(self):
        a, b = graph_module.partition_graph(fixture(), [1])
        self.assertEqual(b['inputs'], [2, 3])
        self.assertEqual(a['parameters'], [1])
        self.assertEqual(b['parameters'], [])

    def test_partition_does_not_change_source_graph(self):
        g = fixture()
        before = copy.deepcopy(g)
        graph_module.partition_graph(g, [1, 2])
        self.assertEqual(g, before)

    def test_rejects_invalid_cuts(self):
        for cuts in ([0], [3], [2, 1], [1, 1], [-1], [4]):
            with self.subTest(cuts=cuts), self.assertRaises(ValueError):
                graph_module.partition_graph(fixture(), cuts)

    def test_rejects_missing_dependency(self):
        g = fixture()
        g['nodes'][0]['inputs'].append(99)
        with self.assertRaises(ValueError):
            graph_module.partition_graph(g, [1])

    def test_rejects_duplicate_producer(self):
        g = fixture()
        g['nodes'][1]['outputs'] = [3]
        with self.assertRaises(ValueError):
            graph_module.validate_graph(g)

    def test_rejects_stateful_graph_without_protocol(self):
        g = fixture()
        g['tensors']['1']['storage'] = 4
        with self.assertRaises(ValueError):
            graph_module.validate_graph(g)

    def test_quantized_tensor_byte_geometry(self):
        t = graph_module.TensorInfo('w', (2560, 4), 8, 0)
        self.assertEqual(t.size, 10880)
        with self.assertRaises(ValueError):
            _ = graph_module.TensorInfo('w', (31, 4), 8, 0).size

    def test_truncated_header_is_rejected(self):
        with self.assertRaises(ValueError):
            graph_module.HeaderReader(io.BytesIO(b'GG')).read(4)

    def test_oversized_header_read_is_rejected(self):
        with self.assertRaises(ValueError):
            graph_module.HeaderReader(io.BytesIO()).read(graph_module.MAX_HEADER + 1)

    def test_write_roundtrip_copies_only_selected_weights(self):
        g = fixture()
        part = graph_module.partition_graph(g, [1])[0]
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'source.bin', Path(tmp) / 'stage.gguf'
            src.write_bytes(struct.pack('<ff', 1.25, 9.0))
            h = graph_module.GraphHeader([], {}, {
                't1': graph_module.TensorInfo('t1', (1,), 0, 0),
                'unused': graph_module.TensorInfo('unused', (1,), 0, 4)}, g, 0)
            receipt = graph_module.write_shard(src, h, part, dst)
            read = graph_module.read_header(dst)
            self.assertEqual(set(read.tensors), {'t1'})
            self.assertEqual(read.graph, part)
            self.assertEqual(receipt['weightTensors'], 1)
            self.assertEqual(dst.read_bytes()[read.data_offset:read.data_offset+4], struct.pack('<f', 1.25))
            with self.assertRaises(FileExistsError):
                graph_module.write_shard(src, h, part, dst)

    def test_incomplete_weight_file_never_creates_shard(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'source.bin', Path(tmp) / 'stage.gguf'
            src.write_bytes(b'')
            g = graph_module.partition_graph(fixture(), [1])[0]
            h = graph_module.GraphHeader([], {}, {'t1': graph_module.TensorInfo('t1', (1,), 0, 0)}, g, 0)
            with self.assertRaises(ValueError):
                graph_module.write_shard(src, h, g, dst)
            self.assertFalse(dst.exists())


if __name__ == '__main__':
    unittest.main()
