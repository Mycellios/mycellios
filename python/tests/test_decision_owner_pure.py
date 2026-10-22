import copy
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

p = Path(__file__).resolve().parents[1] / 'distributed_runtime' / 'decision_owner.py'
s = importlib.util.spec_from_file_location('decision_owner', p)
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)


class DecisionOwnerTests(unittest.TestCase):
    def setUp(self):
        self.binding = {'nodeId': 'node-'+'a'*32, 'machineIdentitySha256': 'b'*64}
        self.native = {'schema': 'mycellios-node-configuration/1', 'nodeId': self.binding['nodeId'],
            'limits': {'maxCpuPercent': 90, 'maxRamMiB': 8192, 'maxConcurrency': 1},
            'policy': {'modelAllowlist': [], 'schedule': [{'days': list(range(7)), 'startMinuteUtc': 0, 'endMinuteUtc': 1440}]}}
        self.control = {'schema': 'mycellios-node-control-state/2', 'contributionEnabled': True, 'draining': False, 'revision': 5}
        self.memory = 4096
        self.guard = m.DecisionOwnerGuard(self.binding, read=lambda key: self.native if key == 'configuration' else self.control,
            identity=lambda: 'b'*64, free_memory=lambda: self.memory, clock=lambda: 1792632000000)

    def test_existing_native_configuration_allows_a_bounded_cpu_stage(self):
        proof = self.guard.check(starting=True)
        self.assertEqual(proof['cpuPercentCeiling'], 20)
        self.assertEqual(proof['privateCommitMiBCeiling'], 2048)
        self.assertNotIn('publicAdmission', proof)

    def test_cannot_use_another_physical_machine_or_node_identity(self):
        with self.assertRaises(ValueError):
            m.DecisionOwnerGuard(self.binding, identity=lambda: 'c'*64)
        self.native['nodeId'] = 'node-'+'d'*32
        with self.assertRaises(ValueError):
            self.guard.check()

    def test_owner_pause_or_draining_revokes_permission(self):
        for update in ({'contributionEnabled': False}, {'draining': True}):
            old = copy.deepcopy(self.control); self.control.update(update)
            with self.assertRaises(ValueError):
                self.guard.check()
            self.control = old

    def test_schedule_and_model_allowlist_are_not_overridden(self):
        self.native['policy']['modelAllowlist'] = ['another-model']
        with self.assertRaises(ValueError): self.guard.check()
        self.native['policy']['modelAllowlist'] = ['jev']
        self.guard.check()
        self.native['policy']['schedule'] = []
        with self.assertRaises(ValueError): self.guard.check()

    def test_reduced_owner_limits_and_low_headroom_are_rejected(self):
        for key, value in (('maxCpuPercent', 19), ('maxRamMiB', 2047), ('maxConcurrency', 0)):
            old = self.native['limits'][key]; self.native['limits'][key] = value
            with self.assertRaises(ValueError): self.guard.check()
            self.native['limits'][key] = old
        self.memory = 1900
        with self.assertRaises(ValueError): self.guard.check(starting=True)
        self.guard.check()
        self.memory = 767
        with self.assertRaises(ValueError): self.guard.check()

    def test_closed_owner_gate_does_not_start_a_child(self):
        self.control['contributionEnabled'] = False
        with patch.object(m.subprocess, 'Popen') as child, self.assertRaises(ValueError):
            m.run_guarded(['not-a-real-executable'], b'', 1, self.guard)
        child.assert_not_called()

    def test_owner_pause_kills_only_the_owned_test_child(self):
        checks = []
        class Guard:
            def check(self, **kwargs):
                checks.append(kwargs)
                if len(checks) > 1: raise ValueError('paused')
        # This child only sleeps. It loads no model and makes no network calls.
        result = m.run_guarded([sys.executable, '-I', '-S', '-B', '-c', 'import time;time.sleep(5)'], b'', 4, Guard())
        self.assertEqual(result.returncode, 125)
        self.assertEqual(result.stdout, b'')
        self.assertEqual(result.owner_failure_code, 'decision_owner_guard_closed')

    def test_cancelled_child_preserves_a_bounded_owner_failure_without_payloads(self):
        for reason, expected in (
            ('decision_native_permit_expired', 'decision_native_permit_expired'),
            ('private value / not a fixed decision code', 'decision_owner_guard_closed'),
        ):
            class Guard:
                checks = 0
                def check(self, **kwargs):
                    self.checks += 1
                    if self.checks > 1: raise ValueError(reason)
            result = m.run_guarded([sys.executable, '-I', '-S', '-B', '-c', 'import time;time.sleep(5)'], b'', 4, Guard())
            self.assertEqual(result.returncode, 125)
            self.assertEqual(result.owner_failure_code, expected)
            self.assertEqual(result.stderr, b'owner_policy_closed')

    def test_absolute_native_timeout_leaves_no_child_running(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            m.run_guarded([sys.executable, '-I', '-S', '-B', '-c', 'import time;time.sleep(5)'], b'', 0.05, self.guard)


if __name__ == '__main__':
    unittest.main()
