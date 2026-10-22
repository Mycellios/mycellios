import importlib.util
import json
from pathlib import Path
import struct
import sys
import time
import unittest

root = Path(__file__).resolve().parents[1] / 'distributed_runtime'
for name in ('decision_reverse', 'decision_qualify'):
    spec = importlib.util.spec_from_file_location(name, root / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
m = sys.modules['decision_qualify']
wire = sys.modules['decision_reverse']


class DecisionQualificationTests(unittest.TestCase):
    def setUp(self):
        self.config = {'expiresAtMs': time.time()*1000 + 60000,
            'address': '127.0.0.1', 'port': 18492, 'certificate': None,
            'operatorSecret': 'o'*64, 'nodes': {}}
        for i, (inputs, outputs) in enumerate((([433,434], [455,1235]),
                ([434,455,1235], [2405]), ([434,435,436,437,455,2405], [3602]))):
            self.config['nodes'][str(i)] = {'token': str(i)*64, 'physicalIdentity': 'host-'+str(i),
                'shardSha256': str(i)*64, 'inputIds': inputs, 'outputIds': outputs}
        self.input = wire.make_frame({'s20': 1, 's53': 64},
                                     {i: b'glob' for i in (433,434,435,436,437)})
        self.calls = []

    def post(self, node, body):
        own = self.config['nodes'][node]
        _, inputs = wire.read_frame(wire.unpack(body['frame']))
        self.assertEqual(set(inputs), set(own['inputIds']))
        if node == '2':
            # A dependency crossing two boundaries must survive the middle stage.
            self.assertEqual(inputs[455], b'live')
            self.assertEqual(inputs[434], b'glob')
        values = {i: (struct.pack('<16f', *range(16)) if i == 3602 else b'live') for i in own['outputIds']}
        self.calls.append(node)
        return {'qualificationOnly': True, 'nodeId': node, 'exitCode': 0,
                'shardSha256': own['shardSha256'], 'frame': wire.pack(wire.make_frame({}, values))}

    def test_dependency_crossing_two_boundaries_and_coverage(self):
        receipt = m.qualify(self.config, self.input, post=self.post)
        self.assertEqual(self.calls, ['0','1','2'])
        self.assertEqual(receipt['logits'], list(range(16)))
        self.assertTrue(receipt['completeDecisionGraph'])
        self.assertFalse(receipt['antseedBuyerValidated'])

    def test_wrong_executor_cannot_complete_a_stage(self):
        def post(node, body):
            result = self.post(node, body)
            result['nodeId'] = 'wrong-node'
            return result
        with self.assertRaisesRegex(ValueError, 'wrong_executor'):
            m.qualify(self.config, self.input, post=post)
        self.assertEqual(self.calls, ['0'])

    def test_native_failure_does_not_fall_back_to_another_host(self):
        def post(node, body):
            self.calls.append(node)
            return {'exitCode': 1, 'qualificationOnly': True}
        with self.assertRaisesRegex(ValueError, 'native_stage_failed'):
            m.qualify(self.config, self.input, post=post)
        self.assertEqual(self.calls, ['0'])

    def test_reusing_one_physical_host_is_rejected_before_transport(self):
        self.config['nodes']['2']['physicalIdentity'] = 'host-0'
        with self.assertRaises(ValueError):
            m.qualify(self.config, self.input, post=self.post)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
