"""Native lease/revocation tests with synthetic tensors, no model execution."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import queue
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[1]/'distributed_runtime'
for name in ('decision_reverse', 'decision_contract', 'decision_tokenize', 'decision_broker',
             'decision_actor', 'decision_gateway', 'decision_activate'):
    spec = importlib.util.spec_from_file_location(name, root/(name+'.py'))
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module; spec.loader.exec_module(module)
b = sys.modules['decision_broker']; g = sys.modules['decision_gateway']; a = sys.modules['decision_actor']
act = sys.modules['decision_activate']; wire = b.wire; c = g.contract


def setup():
    config = {'schema': 'mycellios-native-decision/1', 'mode': 'qualification',
        'activationId': 'test-activation', 'expiresAtMs': time.time()*1000+60000,
        'workerToken': 'w'*64, 'qualificationToken': 'q'*64, 'nodes': {},
        'activationReceipt': '/does-not-exist', 'sourceFiles': {name: hashlib.sha256((root/name).read_bytes()).hexdigest()
            for name in ('decision_gateway.py','decision_broker.py','decision_actor.py','decision_reverse.py',
                         'decision_owner.py','decision_contract.py','decision_tokenize.py')}}
    for i, (inputs, outputs) in enumerate((([433,434],[455,1235]), ([434,455,1235],[2405]),
                                        ([434,435,436,437,455,2405],[3602]))):
        config['nodes'][str(i)] = {'token': str(i)*64, 'stageIndex': i, 'physicalIdentity': str(i)*64,
            'nativeNodeId': 'node-'+str(i)*32, 'ownerSourceSha256': config['sourceFiles']['decision_owner.py'],
            'executableSha256': c.CORE_SHA256, 'shardSha256': g.SHARDS[i], 'inputIds': inputs, 'outputIds': outputs}
    return config


def lease():
    return {'jobId': 'job', 'id': 'lease', 'activationId': 'test-activation', 'deadline': time.time()*1000+30000}


def proof(row):
    return {'nodeId': row['nativeNodeId'], 'physicalIdentity': row['physicalIdentity'],
            'ownerSourceSha256': row['ownerSourceSha256']}


class NativeBrokerTests(unittest.TestCase):
    def test_distinct_owner_and_credential_bindings(self):
        for field in ('physicalIdentity', 'nativeNodeId', 'token'):
            config = setup(); config['nodes']['2'][field] = config['nodes']['0'][field]
            with self.assertRaises(ValueError): b.NativeDecisionBroker(config)
        for invalid in ({**lease(), 'deadline': float('nan')}, {**lease(), 'deadline': time.time()*1000-1},
                        {**lease(), 'activationId': 'other'}, {**lease(), 'deadline': time.time()*1000+600000}):
            with self.assertRaises(ValueError): b.validate_lease(invalid, setup())

    def test_poll_auth_proof_and_freshness_cannot_be_heartbeat_only(self):
        broker = b.NativeDecisionBroker(setup())
        for name, row in broker.config['nodes'].items():
            code, result = broker.executor_message(name, 'poll', {'ownerProof': proof(row),
                'shardSha256': row['shardSha256'], 'executableSha256': row['executableSha256']})
            self.assertEqual(code, 200); self.assertTrue(result['idle'])
        self.assertTrue(broker.ready())
        broker.executor_message('1', 'poll', {'ownerProof': {}})
        self.assertFalse(broker.ready())
        broker.available['1'] = True; broker.seen['1'] = time.time()-16
        self.assertFalse(broker.ready())

    def test_cancel_revokes_permit_and_unblocks_waiter_without_reassignment(self):
        broker = b.NativeDecisionBroker(setup()); row = broker.config['nodes']['0']; current = lease()
        broker.jobs['0'] = {'ticket': 'ticket', 'deadlineMs': current['deadline'], 'lease': current,
                            'cancelled': False, 'queue': queue.Queue(maxsize=1)}
        body = {'ticket': 'ticket', 'ownerProof': proof(row), 'shardSha256': row['shardSha256'],
                'executableSha256': row['executableSha256']}
        code, permit = broker.executor_message('0', 'permit', body)
        self.assertEqual(code, 200); self.assertLessEqual(permit['expiresAtMs'], time.time()*1000+5000)
        broker.cancel('job', 'wrong'); self.assertFalse(broker.jobs['0']['cancelled'])
        broker.cancel('job', 'lease')
        self.assertEqual(broker.executor_message('0','permit',body)[0], 409)
        self.assertEqual(broker.jobs['0']['queue'].get_nowait()['error'], 'decision_cancelled')
        self.assertEqual(set(broker.jobs), {'0'})

    def test_dispatch_validates_ticket_result_and_always_releases_stage(self):
        for bad in (False, True):
            config=setup(); config['expiresAtMs']=time.time()*1000+8000
            broker = b.NativeDecisionBroker(config); broker.seen = {n: time.time() for n in broker.config['nodes']}
            broker.available = {n: True for n in broker.config['nodes']}; row = broker.config['nodes']['0']
            result, errors = [], []
            def work():
                try: result.append(broker.dispatch('0', wire.make_frame({'s20':1,'s53':64}, {i:b'abcd' for i in row['inputIds']}), lease(), threading.Event()))
                except Exception as error: errors.append(error)
            thread = threading.Thread(target=work); thread.start()
            until = time.monotonic()+2
            while '0' not in broker.jobs:
                if time.monotonic() > until: self.fail('dispatch did not publish ticket')
                time.sleep(.005)
            ticket = broker.jobs['0']['ticket']
            self.assertEqual(broker.jobs['0']['deadlineMs'],config['expiresAtMs'])
            frame = wire.pack(wire.make_frame({}, {i:b'live' for i in row['outputIds']}))
            self.assertEqual(broker.executor_message('0','result',{'ticket':'wrong'})[0], 409)
            broker.executor_message('0','result',{'ticket':ticket, 'nodeId':'other' if bad else '0',
                'shardSha256':row['shardSha256'], 'exitCode':0, 'frame':frame})
            thread.join(3); self.assertFalse(thread.is_alive()); self.assertFalse(broker.jobs)
            self.assertEqual(bool(errors), bad); self.assertEqual(bool(result), not bad)


class PermitTests(unittest.TestCase):
    def guard(self, post):
        class Owner:
            def check(self, **kwargs): return {'nodeId':'owner'}
        return a.PermitGuard(Owner(), post, {'ticket':'t','deadlineMs':15000, '_deadlineMonotonic':15})

    def test_transport_failure_does_not_extend_cached_grant(self):
        calls = []
        def post(*args):
            calls.append(1)
            if len(calls)>1: raise urllib.error.URLError('offline')
            return {'authorized':True,'serverNowMs':1000,'expiresAtMs':6000}
        guard = self.guard(post)
        with patch.object(a.time,'monotonic',return_value=1), patch.object(a.time,'time',return_value=999999): guard.check()
        with patch.object(a.time,'monotonic',return_value=3): guard.check()
        self.assertEqual(guard.expires_at, 6)
        with patch.object(a.time,'monotonic',return_value=6):
            with self.assertRaisesRegex(ValueError,'unavailable'): guard.check()

    def test_explicit_revocation_overrides_cached_grant_immediately(self):
        guard = self.guard(lambda *args: {'authorized':True,'serverNowMs':1000,'expiresAtMs':6000})
        with patch.object(a.time,'monotonic',return_value=1): guard.check()
        def deny(*args): raise urllib.error.HTTPError('url',409,'closed',{},None)
        guard.post = deny
        with patch.object(a.time,'monotonic',return_value=3):
            with self.assertRaisesRegex(ValueError,'revoked'): guard.check()
        self.assertEqual(guard.expires_at,0)


class GatewayTests(unittest.TestCase):
    def test_http_scope_authentication_and_bound_cancellation(self):
        config=setup(); config['localPort']=0
        gateway=g.NativeDecisionGateway(config, None); server=gateway.listener()
        runner=threading.Thread(target=server.serve_forever,daemon=True);runner.start()
        url='http://127.0.0.1:'+str(server.server_address[1])
        current=lease(); cancelled=threading.Event()
        gateway.active['job']={'lease':current,'cancelled':cancelled}
        def call(path, token=None, body=None):
            request=urllib.request.Request(url+path, data=None if body is None else json.dumps(body).encode(),
                headers={} if token is None else {'Authorization':'Bearer '+token})
            try:
                with urllib.request.urlopen(request,timeout=3) as response:return response.status,json.load(response)
            except urllib.error.HTTPError as error:return error.code,json.load(error)
        try:
            self.assertEqual(call('/health')[0],401)
            self.assertEqual(call('/health',config['workerToken'])[0],503)
            self.assertEqual(call('/decide',config['workerToken'],{})[0],403)
            self.assertEqual(call('/qualify',config['workerToken'],{})[0],401)
            self.assertEqual(call('/qualify',config['qualificationToken'],{})[0],400)
            self.assertEqual(call('/cancel',config['qualificationToken'],{'jobId':'job','leaseId':'wrong',
                'activationId':config['activationId']})[0],200)
            self.assertFalse(cancelled.is_set())
            self.assertEqual(call('/cancel',config['qualificationToken'],{'jobId':'job','leaseId':'lease',
                'activationId':config['activationId']})[0],200)
            self.assertTrue(cancelled.is_set())
        finally:server.shutdown();server.server_close();runner.join(2)

    def test_activation_cannot_reuse_an_unrelated_reference(self):
        with self.assertRaisesRegex(ValueError,'pinned_reference_artifact'):
            act.activation(setup(),{'passed':True},b'fake reference',b'fake input',{'exitCode':0})

    def test_cross_stage_dependency_and_actual_token_accounting(self):
        config = setup(); broker = b.NativeDecisionBroker(config)
        value = {'schema':'mycellios-decisions/1','state':'test','questions':{'route':{
            'type':'choice','instructions':'select','criteria':{'b':'B','a':'A'}}}}
        class Encoder:
            def encode(self, value): return g.tokenizer_module.encode_input(value, lambda text:[1,2])
        calls = []
        def dispatch(name, frame, current, cancelled):
            _, tensors = wire.read_frame(frame); row = config['nodes'][name]
            if name == '2': self.assertEqual(tensors[455], b'live'); self.assertIn(435,tensors)
            calls.append(name)
            return wire.make_frame({}, {i:struct.pack('<16f',2.,0.,*([-10000.]*14)) if i==3602 else b'live'
                for i in row['outputIds']}), {'elapsedMs':1}
        broker.dispatch = dispatch
        gateway = g.NativeDecisionGateway(config, Encoder(), broker=broker)
        envelope, receipt = gateway.execute(value, lease(), threading.Event())
        self.assertEqual(calls, ['0','1','2']); self.assertEqual(envelope['result']['value'], 'a')
        self.assertEqual(envelope['usage']['completion_tokens'],0)
        self.assertLess(envelope['usage']['prompt_tokens'],64)
        self.assertFalse(receipt['publicAdmissionValidated']); self.assertFalse(receipt['antseedBuyerValidated'])
        self.assertEqual(gateway.health()['status'],'qualifying')
        config['mode']='serving'; config['nativeCellId']='cell-id'
        self.assertFalse(gateway.qualified())

    def test_source_and_vendor_tampering_prevents_activation(self):
        config=setup(); g.verify_sources(config)
        config['sourceFiles']['decision_actor.py']='0'*64
        with self.assertRaisesRegex(ValueError,'source_changed'): g.verify_sources(config)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); (root/'module.py').write_text('safe')
            vendor={'vendorPath':folder,'vendorFiles':{'module.py':hashlib.sha256(b'safe').hexdigest()}}
            g.verify_vendor(vendor); (root/'extra.py').write_text('extra')
            with self.assertRaisesRegex(ValueError,'closure'): g.verify_vendor(vendor)


if __name__ == '__main__': unittest.main()
