"""Authenticated native decision subleases; distinct from the private QA relay.

Only the in-process gateway can dispatch work. The TLS listener accepts executor
polls/results/permit refreshes, never buyer requests or operator 'invoke' calls.
The enrolled Mycellios worker remains responsible for public job admission.
"""
from __future__ import annotations

import hashlib
import hmac
from http.server import BaseHTTPRequestHandler
import importlib.util
import json
from pathlib import Path
import queue
import re
import secrets
import ssl
import threading
import time

if __package__:
    from . import decision_reverse as wire
else:
    spec = importlib.util.spec_from_file_location('decision_reverse', Path(__file__).with_name('decision_reverse.py'))
    wire = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wire)

SHA = re.compile(r'[a-f0-9]{64}\Z')
IDENTITY = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z')


class NativeStageFailure(ValueError):
    def __init__(self, node, result):
        super().__init__('decision_native_stage_failed')
        self.details = {'node': node, **{k: result.get(k) for k in ('exitCode', 'error', 'ownerFailureCode', 'elapsedMs')}}


def validate_lease(lease, config, *, now_ms=None):
    now = time.time()*1000 if now_ms is None else now_ms
    if not isinstance(lease, dict) or set(lease) != {'jobId', 'id', 'deadline', 'activationId'} \
            or any(not isinstance(lease[k], str) or not IDENTITY.fullmatch(lease[k]) for k in ('jobId', 'id')) \
            or lease['activationId'] != config['activationId'] \
            or type(lease['deadline']) not in (int, float) or not now < lease['deadline'] <= now+540000:
        raise ValueError('decision_native_lease_required')
    return lease


def validate_setup(config):
    if config.get('schema') != 'mycellios-native-decision/1' or config.get('mode') not in ('qualification', 'serving') \
            or not isinstance(config.get('activationId'), str) or not IDENTITY.fullmatch(config['activationId']):
        raise ValueError('decision_native_configuration')
    if config['mode'] == 'qualification' and not time.time()*1000 < config.get('expiresAtMs', 0) <= time.time()*1000+6*3600000:
        raise ValueError('decision_native_qualification_expiry')
    if config['mode'] == 'serving' and not IDENTITY.fullmatch(str(config.get('nativeCellId', ''))):
        raise ValueError('decision_native_enrolled_cell_identity_required')
    nodes = config.get('nodes')
    if not isinstance(nodes, dict) or len(nodes) != 3:
        raise ValueError('decision_native_three_stages_required')
    physical, identities, credentials = set(), set(), [config.get('workerToken'), config.get('qualificationToken')]
    for index, (name, node) in enumerate(nodes.items()):
        if not IDENTITY.fullmatch(name) or node.get('stageIndex') != index \
                or not SHA.fullmatch(str(node.get('physicalIdentity', ''))) \
                or not SHA.fullmatch(str(node.get('ownerSourceSha256', ''))) \
                or not SHA.fullmatch(str(node.get('shardSha256', ''))) \
                or not SHA.fullmatch(str(node.get('executableSha256', ''))) \
                or not re.fullmatch(r'node-[a-f0-9]{32}', str(node.get('nativeNodeId', ''))):
            raise ValueError('decision_native_executor_binding')
        physical.add(node['physicalIdentity']); identities.add(node['nativeNodeId']); credentials.append(node.get('token'))
    if len(physical) != 3 or len(identities) != 3 or len(set(credentials)) != len(credentials) \
            or any(not isinstance(x, str) or len(x) < 64 for x in credentials):
        raise ValueError('decision_native_distinct_owner_credentials_required')


class NativeDecisionBroker:
    def __init__(self, config):
        validate_setup(config)
        self.config = config
        self.lock = threading.RLock()
        self.jobs, self.seen, self.available = {}, {}, {}
        self.serial = threading.BoundedSemaphore(1)

    def owner_valid(self, node, proof):
        expected = self.config['nodes'][node]
        return isinstance(proof, dict) and proof.get('nodeId') == expected['nativeNodeId'] \
            and proof.get('physicalIdentity') == expected['physicalIdentity'] \
            and proof.get('ownerSourceSha256') == expected['ownerSourceSha256']

    def ready(self):
        with self.lock:
            return all(self.available.get(node) is True and time.time()-self.seen.get(node, 0) < 15
                       for node in self.config['nodes'])

    def expired(self):
        return self.config['mode'] == 'qualification' and time.time()*1000 >= self.config['expiresAtMs']

    def executor_message(self, node, action, body):
        expected = self.config['nodes'][node]
        with self.lock:
            job = self.jobs.get(node)
            if action in ('poll', 'permit'):
                valid = self.owner_valid(node, body.get('ownerProof')) \
                    and body.get('shardSha256') == expected['shardSha256'] \
                    and body.get('executableSha256') == expected['executableSha256']
                self.seen[node] = time.time(); self.available[node] = valid
                if not valid: return 409, {'error': 'owner_unavailable'}
            if action == 'poll':
                result = ({k: v for k, v in job.items() if k not in ('queue', 'cancelled')}
                          if job and not job['cancelled'] else {'idle': True})
                return 200, {**result, 'serverNowMs': time.time()*1000}
            if not job or body.get('ticket') != job['ticket'] or job['cancelled'] or time.time()*1000 >= job['deadlineMs']:
                return 409, {'error': 'lease_closed'}
            if action == 'permit':
                now = time.time()*1000
                return 200, {'authorized': True, 'serverNowMs': now, 'expiresAtMs': min(job['deadlineMs'], now+5000)}
            try: job['queue'].put_nowait(body)
            except queue.Full: return 409, {'error': 'duplicate_result'}
            return 200, {'accepted': True}

    def cancel(self, job_id, lease_id):
        with self.lock:
            for job in self.jobs.values():
                if job['lease']['jobId'] == job_id and job['lease']['id'] == lease_id:
                    job['cancelled'] = True
                    try: job['queue'].put_nowait({'error': 'decision_cancelled'})
                    except queue.Full: pass

    def dispatch(self, node, frame, lease, cancelled):
        validate_lease(lease, self.config)
        if self.expired(): raise ValueError('decision_qualification_expired')
        expected = self.config['nodes'][node]
        header, values = wire.read_frame(frame)
        if set(values) != set(expected['inputIds']) or header.get('symbols', {}).get('s20') != 1 \
                or type(header.get('symbols', {}).get('s53')) is not int or not 1 <= header['symbols']['s53'] <= 256:
            raise ValueError('decision_native_frame_binding')
        now = time.time()*1000
        job = {'schema': 'mycellios-native-decision-stage/1', 'ticket': secrets.token_hex(24),
            'scope': self.config['mode'], 'nodeId': node, 'stageIndex': expected['stageIndex'],
            'shardSha256': expected['shardSha256'], 'frame': wire.pack(frame),
            'lease': lease, 'deadlineMs': min(lease['deadline'], now+239000),
            'cancelled': False, 'queue': queue.Queue(maxsize=1)}
        if self.config['mode'] == 'qualification':
            job['deadlineMs'] = min(job['deadlineMs'], self.config['expiresAtMs'])
        with self.lock:
            if node in self.jobs or not self.ready(): raise ValueError('decision_executors_busy_or_unavailable')
            self.jobs[node] = job
        try:
            while time.time()*1000 < job['deadlineMs']:
                if cancelled.is_set(): raise ValueError('decision_cancelled')
                try:
                    result = job['queue'].get(timeout=0.5)
                except queue.Empty: continue
                if result.get('exitCode') != 0 or result.get('error'): raise NativeStageFailure(node, result)
                if result.get('nodeId') != node or result.get('shardSha256') != expected['shardSha256']:
                    raise ValueError('decision_native_result_binding')
                output = wire.unpack(result['frame'])
                _, tensors = wire.read_frame(output)
                if set(tensors) != set(expected['outputIds']): raise ValueError('decision_native_output_binding')
                return output, {k: result.get(k) for k in ('elapsedMs', 'nativeMetrics')}
            raise TimeoutError('decision_native_stage_deadline')
        finally:
            with self.lock:
                if self.jobs.get(node) is job: self.jobs.pop(node)

    def listener(self):
        broker = self
        class Handler(BaseHTTPRequestHandler):
            def reply(self, code, body):
                raw = json.dumps(body, allow_nan=False, separators=(',', ':')).encode()
                self.send_response(code); self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)

            def do_POST(self):
                parts = self.path.strip('/').split('/')
                if len(parts) != 2 or parts[0] not in ('poll', 'permit', 'result') or parts[1] not in broker.config['nodes']:
                    return self.reply(404, {'error': 'not_found'})
                action, node = parts; expected = broker.config['nodes'][node]
                if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer '+expected['token']):
                    return self.reply(401, {'error': 'unauthorized'})
                try:
                    self.connection.settimeout(30)
                    length = int(self.headers.get('Content-Length', '0'))
                    if self.headers.get('Transfer-Encoding') or not 0 < length <= wire.MAX_BODY: raise ValueError()
                    raw = self.rfile.read(length)
                    if len(raw) != length: raise ValueError()
                    body = wire._json(raw)
                    if not isinstance(body, dict): raise ValueError()
                    if broker.expired(): return self.reply(410, {'error': 'qualification_expired'})
                    code, result = broker.executor_message(node, action, body)
                    return self.reply(code, result)
                except (ValueError, TypeError, KeyError, OSError):
                    return self.reply(400, {'error': 'invalid_native_decision_envelope'})
            def log_message(self, *args): pass
        host = wire.QualificationServer((self.config['address'], self.config['port']), Handler)
        host.daemon_threads = True
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(self.config['certificate'], self.config['key'])
        host.socket = context.wrap_socket(host.socket, server_side=True, do_handshake_on_connect=False)
        original = host.get_request
        def get_request():
            connection, peer = original(); connection.settimeout(10); return connection, peer
        host.get_request = get_request
        return host
