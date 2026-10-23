"""Loopback decision gateway for an enrolled Mycellios worker.

Qualification and serving use separate credentials and explicit modes. A local
backend canary proves the model route, never public worker enrollment or AntSeed
buyer delivery. Only the native worker may delegate admitted serving leases.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler
import importlib.util
import json
import math
from pathlib import Path
import secrets
import struct
import sys
import threading
import time

if __package__:
    from . import decision_broker as broker_module
    from . import decision_contract as contract
    from . import decision_tokenize as tokenizer_module
else:
    def sibling(name):
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
    broker_module, contract, tokenizer_module = sibling('decision_broker'), sibling('decision_contract'), sibling('decision_tokenize')
wire = broker_module.wire

SHARDS = ['1ea5b923a3359eb3d6ecd683792b6723795c8d2fdf3d2a31d50219bf109dc325',
          '02df8d07f3d7c7e47829cbb55d73c4a18d39096a5ed030f97333be9c7a64a6a5',
          '23fd6d438241135c4a23dab917dc81691d361ffca786aa84b7c1bc6dc23d6e35']
BOUNDARIES = [0, 8, 20, 32]


def verify_vendor(config):
    root = Path(config['vendorPath']).resolve(strict=True)
    files = config['vendorFiles']
    actual = {str(p.relative_to(root)).replace('\\', '/') for p in root.rglob('*') if p.is_file()}
    if not isinstance(files, dict) or not files or actual != set(files):
        raise ValueError('decision_tokenizer_vendor_closure')
    for name, digest in files.items():
        path = root/name
        if path.is_symlink() or root not in path.resolve().parents or not broker_module.SHA.fullmatch(str(digest)) \
                or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('decision_tokenizer_vendor_changed')
    return root


def verify_sources(config):
    root = Path(__file__).parent.resolve()
    expected = {'decision_gateway.py', 'decision_broker.py', 'decision_actor.py', 'decision_reverse.py',
                'decision_owner.py', 'decision_contract.py', 'decision_tokenize.py'}
    files = config['sourceFiles']
    if set(files) != expected: raise ValueError('decision_gateway_source_closure')
    for name, digest in files.items():
        path = root/name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('decision_gateway_source_changed')
    route = [{k: row[k] for k in ('nativeNodeId', 'physicalIdentity', 'shardSha256', 'executableSha256', 'ownerSourceSha256')}
             for row in config['nodes'].values()]
    return hashlib.sha256(json.dumps({'files': files, 'route': route, 'model': contract.DIGEST,
        'tokenizer': contract.TOKENIZER_SHA256, 'tokenizerBackend': '0.22.2',
        'vendorFiles': config.get('vendorFiles', {})}, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class NativeDecisionGateway:
    def __init__(self, config, encoder, *, broker=None):
        self.config, self.encoder = config, encoder
        self.broker = broker or broker_module.NativeDecisionBroker(config)
        self.source_id = verify_sources(config)
        if any(row['shardSha256'] != SHARDS[i] or row['executableSha256'] != contract.CORE_SHA256
               for i, row in enumerate(config['nodes'].values())):
            raise ValueError('decision_gateway_shard_plan')
        self.active, self.active_lock = {}, threading.RLock()

    def qualified(self):
        try:
            raw = Path(self.config['activationReceipt']).read_bytes()
            if len(raw) > 32768: return False
            receipt = wire._json(raw)
            return receipt.get('schema') == 'mycellios-decision-activation/1' \
                and receipt.get('activationId') == self.config['activationId'] \
                and receipt.get('sourceId') == self.source_id and receipt.get('modelDigest') == contract.DIGEST \
                and receipt.get('tokenizerSha256') == contract.TOKENIZER_SHA256 \
                and receipt.get('threeDistinctPhysicalStages') is True and receipt.get('passed') is True
        except (ValueError, KeyError, TypeError, OSError): return False

    def health(self):
        serving = self.config['mode'] == 'serving' and self.qualified() and not self.broker.expired() and self.broker.ready()
        status = {'status': 'ready' if serving else 'qualifying', 'runtime': 'mycellios-decision-pipeline/1',
            'qualification_only': self.config['mode'] != 'serving', 'model': contract.MODEL,
            'revision': contract.REVISION, 'artifact_identity': contract.DIGEST,
            'tokenizer_sha256': contract.TOKENIZER_SHA256, 'activation_id': self.config['activationId'],
            'max_input_tokens': contract.CONTEXT_LIMIT,
            'executor_observations': self.broker.observations(),
            'stages': [{'node_id': row['nativeNodeId'], 'physical_identity': row['physicalIdentity'],
                        'layer_start': BOUNDARIES[i], 'layer_end': BOUNDARIES[i+1], 'backend': 'cpu',
                        'shard_sha256': row['shardSha256']} for i, row in enumerate(self.config['nodes'].values())]}
        if self.config['mode'] == 'qualification':
            with self.broker.lock:
                status['qualification_executors'] = {name: {
                    'owner_available': self.broker.available.get(name) is True,
                    'seconds_since_poll': time.time()-self.broker.seen[name] if name in self.broker.seen else None,
                } for name in self.config['nodes']}
        return status

    def execute(self, value, lease, cancelled):
        value = contract.parse_input(value)
        broker_module.validate_lease(lease, self.config)
        raw = self.encoder.encode(value)
        header, tensors = wire.read_frame(raw)
        input_frame_sha256 = hashlib.sha256(raw).hexdigest()
        if header.get('tokenizerSha256') != contract.TOKENIZER_SHA256 \
                or header.get('requestDigest') != contract.request_digest(value):
            raise ValueError('decision_gateway_preprocessing_binding')
        original, stages = set(tensors), []
        started = time.monotonic()
        for node, row in self.config['nodes'].items():
            frame = wire.make_frame(header['symbols'], {tid: tensors[tid] for tid in row['inputIds']})
            output, metrics = self.broker.dispatch(node, frame, lease, cancelled)
            out, values = wire.read_frame(output)
            if set(values) & original: raise ValueError('decision_gateway_global_tensor_overwrite')
            tensors.update(values)
            stages.append({'nodeId': row['nativeNodeId'], 'physicalIdentity': row['physicalIdentity'],
                'shardSha256': row['shardSha256'], 'stageIndex': row['stageIndex'],
                'computeMs': out.get('computeMs'), **metrics})
        if len(tensors.get(3602, b'')) != 64: raise ValueError('decision_gateway_head_shape')
        logits = list(struct.unpack('<16f', tensors[3602]))
        if not all(math.isfinite(x) for x in logits): raise ValueError('decision_gateway_nonfinite_output')
        envelope = contract.decode(value, logits, header['inputTokens'])
        receipt = {'schema': 'mycellios-native-decision-receipt/1', 'qualificationOnly': self.config['mode'] != 'serving',
            'publicAdmissionValidated': False, 'antseedBuyerValidated': False, 'sourceId': self.source_id,
            'jobId': lease['jobId'], 'activationId': self.config['activationId'], 'tokenizerSha256': contract.TOKENIZER_SHA256,
            'modelDigest': contract.DIGEST, 'requestDigest': header['requestDigest'], 'logits': logits,
            'inputFrameSha256': input_frame_sha256,
            'stages': stages, 'wallMs': (time.monotonic()-started)*1000, 'inputTokens': header['inputTokens']}
        return envelope, receipt

    def listener(self):
        gateway = self
        class Handler(BaseHTTPRequestHandler):
            def authorized(self, qualification=False):
                token = gateway.config['qualificationToken' if qualification else 'workerToken']
                return self.client_address[0] == '127.0.0.1' and hmac.compare_digest(
                    self.headers.get('Authorization', ''), 'Bearer '+token)
            def reply(self, code, body):
                raw = json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
                self.send_response(code); self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
            def do_GET(self):
                if self.path != '/health' or not (self.authorized() or self.authorized(True)):
                    return self.reply(401, {'error': 'unauthorized'})
                body = gateway.health(); return self.reply(200 if body['status'] == 'ready' else 503, body)
            def do_POST(self):
                qualification = self.path == '/qualify' or (self.path == '/cancel' and gateway.config['mode'] == 'qualification')
                if self.path not in ('/decide', '/qualify', '/cancel') or not self.authorized(qualification):
                    return self.reply(401, {'error': 'unauthorized'})
                if qualification != (gateway.config['mode'] == 'qualification'):
                    return self.reply(403, {'error': 'decision_scope_mismatch'})
                try:
                    self.connection.settimeout(30)
                    length = int(self.headers.get('Content-Length', '0'))
                    if self.headers.get('Transfer-Encoding') or not 0 < length <= 36*1024: raise ValueError()
                    raw = self.rfile.read(length)
                    if len(raw) != length: raise ValueError()
                    body = wire._json(raw)
                    if self.path == '/cancel':
                        with gateway.active_lock:
                            active = gateway.active.get(body.get('jobId'))
                            if active and active['lease']['id'] == body.get('leaseId') \
                                    and body.get('activationId') == gateway.config['activationId']:
                                active['cancelled'].set(); gateway.broker.cancel(body['jobId'], body['leaseId'])
                        return self.reply(200, {'accepted': True})
                    if not qualification and not gateway.qualified(): return self.reply(503, {'error': 'decision_activation_unqualified'})
                    value = dict(body)
                    if qualification:
                        lease = {'jobId': 'qual-'+secrets.token_hex(16), 'id': 'qual-'+secrets.token_hex(16),
                            'deadline': time.time()*1000+540000, 'activationId': gateway.config['activationId']}
                    else: lease = value.pop('lease')
                    broker_module.validate_lease(lease, gateway.config)
                    value = contract.parse_input(value)
                except (ValueError, KeyError, TypeError): return self.reply(400, {'error': 'invalid_decision_or_native_lease'})
                if not gateway.broker.serial.acquire(blocking=False): return self.reply(429, {'error': 'decision_cell_busy'})
                cancelled = threading.Event()
                with gateway.active_lock: gateway.active[lease['jobId']] = {'lease': lease, 'cancelled': cancelled}
                try:
                    envelope, receipt = gateway.execute(value, lease, cancelled)
                    folder = Path(gateway.config['receiptDirectory']); folder.mkdir(parents=True, exist_ok=True)
                    (folder/(lease['jobId']+'.json')).write_text(json.dumps(receipt, indent=2))
                    return self.reply(200, {'envelope': envelope, 'receipt': receipt} if qualification else envelope)
                except (ValueError, KeyError, TypeError, OSError, TimeoutError) as error:
                    code = str(error) if isinstance(error, ValueError) and str(error).startswith('decision_') else type(error).__name__
                    folder = Path(gateway.config['receiptDirectory']); folder.mkdir(parents=True, exist_ok=True)
                    (folder/(lease['jobId']+'.failure.json')).write_text(json.dumps({
                        'schema': 'mycellios-native-decision-failure/1', 'jobId': lease['jobId'],
                        'sourceId': gateway.source_id, 'errorCode': code, 'nativeFailure': getattr(error, 'details', None),
                        'executorObservations': gateway.broker.observations(),
                        'publicAdmissionValidated': False}))
                    return self.reply(503, {'error': 'decision_native_route_failed'})
                finally:
                    gateway.broker.cancel(lease['jobId'], lease['id'])
                    with gateway.active_lock: gateway.active.pop(lease['jobId'], None)
                    gateway.broker.serial.release()
            def log_message(self, *args): pass
        host = wire.QualificationServer(('127.0.0.1', self.config['localPort']), Handler)
        host.daemon_threads = True
        return host


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--config', required=True)
    config = wire._json(Path(parser.parse_args().config).read_bytes())
    if config.get('vendorPath'): sys.path.insert(0, str(verify_vendor(config)))
    gateway = NativeDecisionGateway(config, tokenizer_module.HfDecisionEncoder(config['tokenizer']))
    relay = gateway.broker.listener()
    threading.Thread(target=relay.serve_forever, daemon=True).start()
    local = gateway.listener()
    expiry = None
    if config['mode'] == 'qualification':
        expiry = threading.Timer(max(0, (config['expiresAtMs']-time.time()*1000)/1000), local.shutdown)
        expiry.daemon = True; expiry.start()
    try: local.serve_forever()
    finally:
        if expiry: expiry.cancel()
        relay.shutdown(); relay.server_close(); local.server_close()


if __name__ == '__main__': main()
