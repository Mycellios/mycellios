"""Private qualification relay. Executors poll outward; this grants no public admission."""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import queue
import secrets
import ssl
import struct
import subprocess
import threading
import time
import urllib.request
import zlib

MAX_RAW = 64 * 1024 * 1024
MAX_BODY = 48 * 1024 * 1024
MAX_HEADER = 16384


class QualificationServer(ThreadingHTTPServer):
    """Bound TLS handshakes and request workers without blocking the accept loop."""
    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def validate_config(config, *, executor_mode, now_ms=None):
    """Qualification expires; it cannot silently become a permanent service."""
    now = time.time()*1000 if now_ms is None else now_ms
    expiry = config.get('expiresAtMs')
    if type(expiry) not in (int, float) or not now < expiry <= now + 6*3600000:
        raise ValueError('qualification_expiry_required')
    stage_budget = config.get('stageDeadlineMs', 180000)
    if type(stage_budget) is not int or not 1000 <= stage_budget <= 240000:
        raise ValueError('qualification_stage_deadline_boundary')
    if executor_mode:
        if type(config.get('mappedCpuWeights', False)) is not bool:
            raise ValueError('qualification_cpu_load_mode_invalid')
        secrets_to_check = [config.get('token')]
        if not config.get('serverUrl', '').startswith('https://'):
            raise ValueError('qualification_https_required')
    else:
        nodes = config.get('nodes')
        if not isinstance(nodes, dict) or not 1 <= len(nodes) <= 3:
            raise ValueError('qualification_node_count')
        physical = [node.get('physicalIdentity') for node in nodes.values()]
        if any(not isinstance(x, str) or not x for x in physical) or len(set(physical)) != len(physical):
            raise ValueError('qualification_distinct_physical_nodes_required')
        secrets_to_check = [config.get('operatorSecret')] + [node.get('token') for node in nodes.values()]
    if any(not isinstance(secret, str) or len(secret) < 64 for secret in secrets_to_check):
        raise ValueError('qualification_secret_too_short')
    if len(set(secrets_to_check)) != len(secrets_to_check):
        raise ValueError('qualification_distinct_credentials_required')


def _unique_object(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('decision_duplicate_json_key')
        result[key] = value
    return result


def _json(raw):
    def invalid_constant(value):
        raise ValueError('decision_nonfinite_json')
    return json.loads(raw, object_pairs_hook=_unique_object, parse_constant=invalid_constant)


def read_frame(raw):
    if not 4 <= len(raw) <= MAX_RAW:
        raise ValueError('decision_frame_size')
    n = struct.unpack('<I', raw[:4])[0]
    if not 0 < n <= MAX_HEADER or len(raw) < n + 4:
        raise ValueError('decision_frame_header')
    h = _json(raw[4:4+n])
    if not isinstance(h, dict):
        raise ValueError('decision_frame_header_object_required')
    tensors = h.get('tensors')
    if not isinstance(tensors, list) or not 1 <= len(tensors) <= 16:
        raise ValueError('decision_frame_arity')
    offset, result = 4 + n, {}
    for t in tensors:
        tid, size = t.get('id'), t.get('bytes')
        if type(tid) is not int or not 0 <= tid <= 1000000 or tid in result:
            raise ValueError('decision_frame_tensor_identity')
        if type(size) is not int or size <= 0 or size > MAX_RAW or offset + size > len(raw):
            raise ValueError('decision_frame_tensor_size')
        result[tid] = raw[offset:offset+size]
        offset += size
    if offset != len(raw):
        raise ValueError('decision_frame_trailing_bytes')
    return h, result


def make_frame(symbols, tensors):
    h = json.dumps({'symbols': symbols, 'tensors': [
        {'id': tid, 'bytes': len(data)} for tid, data in tensors.items()
    ]}, allow_nan=False, separators=(',', ':')).encode()
    raw = struct.pack('<I', len(h)) + h + b''.join(tensors.values())
    read_frame(raw)
    return raw


def pack(raw):
    read_frame(raw)
    return {'sha256': hashlib.sha256(raw).hexdigest(),
            'zlibBase64': base64.b64encode(zlib.compress(raw, 1)).decode('ascii')}


def unpack(body):
    data = body.get('zlibBase64')
    if not isinstance(data, str) or len(data) > MAX_BODY:
        raise ValueError('decision_compressed_size')
    encoded = base64.b64decode(data, validate=True)
    z = zlib.decompressobj()
    raw = z.decompress(encoded, MAX_RAW + 1)
    if len(raw) > MAX_RAW or not z.eof or z.unused_data or z.unconsumed_tail:
        raise ValueError('decision_decompression_boundary')
    if not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), str(body.get('sha256', ''))):
        raise ValueError('decision_wire_digest_mismatch')
    read_frame(raw)
    return raw


def server(config):
    """Only authenticated loopback operators can create these private QA tickets."""
    nodes = config['nodes']
    jobs, waiters, last_seen = {}, {}, {}
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/status' or self.client_address[0] not in ('127.0.0.1', '::1', config['address']):
                return self.reply(404, {'error': 'not_found'})
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + config['operatorSecret']):
                return self.reply(401, {'error': 'unauthorized'})
            with lock:
                snapshot = {node: {'pollAgeSeconds': time.time()-last_seen[node] if node in last_seen else None,
                                   'busy': node in jobs} for node in nodes}
            return self.reply(200, {'qualificationOnly': True, 'nodes': snapshot,
                                   'expiresAtMs': config['expiresAtMs']})

        def reply(self, status, body):
            raw = json.dumps(body, allow_nan=False, separators=(',', ':')).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            if time.time()*1000 >= config['expiresAtMs']:
                return self.reply(410, {'error': 'qualification_expired'})
            parts = self.path.strip('/').split('/')
            if len(parts) != 2 or parts[1] not in nodes:
                return self.reply(404, {'error': 'not_found'})
            action, node = parts
            own = nodes[node]
            supplied = self.headers.get('Authorization', '')
            secret = config['operatorSecret'] if action == 'invoke' else own['token']
            if not hmac.compare_digest(supplied, 'Bearer ' + secret):
                return self.reply(401, {'error': 'unauthorized'})
            if action == 'invoke' and self.client_address[0] not in ('127.0.0.1', '::1', config['address']):
                return self.reply(403, {'error': 'local_qualification_operator_only'})
            try:
                self.connection.settimeout(30)
                n = int(self.headers.get('Content-Length', '0'))
                if not 0 < n <= MAX_BODY or self.headers.get('Transfer-Encoding'):
                    raise ValueError('body_boundary')
                data = self.rfile.read(n)
                if len(data) != n:
                    raise ValueError('body_short')
                body = _json(data)
                if not isinstance(body, dict):
                    raise ValueError('body_object_required')
                if action == 'poll':
                    if body.get('shardSha256') != own['shardSha256'] or body.get('executableSha256') != own['executableSha256']:
                        return self.reply(409, {'error': 'executor_artifact_mismatch'})
                    if own.get('ownerSourceSha256'):
                        proof = body.get('ownerProof', {})
                        if not isinstance(proof, dict) or proof.get('nodeId') != own.get('nativeNodeId') \
                                or proof.get('physicalIdentity') != own['physicalIdentity'] \
                                or proof.get('ownerSourceSha256') != own['ownerSourceSha256']:
                            return self.reply(409, {'error': 'executor_owner_binding_mismatch'})
                    with lock:
                        last_seen[node] = time.time()
                        item = jobs.get(node)
                        if item and item['deadlineMs'] <= time.time()*1000:
                            jobs.pop(node, None)
                            item = None
                    return self.reply(200, item or {'idle': True})
                if action == 'result':
                    with lock:
                        waiter = waiters.get(body.get('ticket'))
                        if not waiter or waiter['node'] != node or waiter['deadlineMs'] <= time.time()*1000:
                            return self.reply(409, {'error': 'expired_ticket'})
                        try:
                            waiter['queue'].put_nowait(body)
                        except queue.Full:
                            return self.reply(409, {'error': 'duplicate_result'})
                    return self.reply(200, {'accepted': True})
                if action != 'invoke':
                    return self.reply(404, {'error': 'not_found'})
                raw = unpack(body['frame'])
                h, values = read_frame(raw)
                if set(values) != set(own['inputIds']) or h.get('symbols', {}).get('s20') != 1:
                    raise ValueError('stage_inputs_mismatch')
                now = time.time()*1000
                deadline = body.get('deadlineMs')
                if type(deadline) not in (int, float) or not now < deadline <= min(now + config.get('stageDeadlineMs', 180000), config['expiresAtMs']):
                    raise ValueError('deadline_out_of_budget')
                ticket, q = secrets.token_hex(24), queue.Queue(maxsize=1)
                with lock:
                    if any(w['node'] == node for w in waiters.values()):
                        return self.reply(409, {'error': 'executor_busy'})
                    if time.time() - last_seen.get(node, 0) > 15:
                        return self.reply(503, {'error': 'executor_offline'})
                    waiters[ticket] = {'node': node, 'deadlineMs': deadline, 'queue': q}
                    jobs[node] = {'ticket': ticket, 'deadlineMs': deadline, 'frame': body['frame'],
                                  'shardSha256': own['shardSha256'], 'qualificationOnly': True}
                try:
                    result = q.get(timeout=(deadline-now)/1000)
                    return self.reply(200, result)
                except queue.Empty:
                    return self.reply(504, {'error': 'executor_timeout'})
                finally:
                    with lock:
                        waiters.pop(ticket, None)
                        if jobs.get(node, {}).get('ticket') == ticket:
                            jobs.pop(node, None)
            except (ValueError, KeyError, TypeError, zlib.error):
                return self.reply(400, {'error': 'invalid_qualification_envelope'})

        def log_message(self, *args):
            pass

    host = QualificationServer((config['address'], config['port']), Handler)
    host.daemon_threads = True
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(config['certificate'], config['key'])
    host.socket = context.wrap_socket(host.socket, server_side=True, do_handshake_on_connect=False)
    original = host.get_request

    def get_request():
        connection, peer = original()
        connection.settimeout(10)
        # SSL negotiation happens on the request worker's first read. Performing
        # it here stalls all healthy executor heartbeats behind one slow peer.
        return connection, peer

    host.get_request = get_request
    return host


def executor(config):
    """Runs a fixed Windows QA executable, never a command supplied by the relay."""
    for path, digest in ((config['shard'], config['shardSha256']), (config['executable'], config['executableSha256'])):
        h = hashlib.sha256()
        with Path(path).open('rb') as f:
            for b in iter(lambda: f.read(1048576), b''):
                h.update(b)
        if not hmac.compare_digest(h.hexdigest(), digest):
            raise ValueError('executor_local_artifact_mismatch')
    context = ssl.create_default_context(cafile=config['serverCertificate'])
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    owner, guarded_run = None, None
    if config.get('ownerGuard') is not None:
        path = Path(__file__).with_name('decision_owner.py')
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != config.get('ownerSourceSha256'):
            raise ValueError('executor_owner_source_mismatch')
        spec = importlib.util.spec_from_file_location('mycellios_decision_owner', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        owner, guarded_run = module.DecisionOwnerGuard(config['ownerGuard']), module.run_guarded

    def post(action, body):
        request = urllib.request.Request(config['serverUrl'] + '/' + action + '/' + config['nodeId'],
            data=json.dumps(body, allow_nan=False, separators=(',', ':')).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['token']})
        with urllib.request.urlopen(request, context=context, timeout=30) as response:
            raw = response.read(MAX_BODY + 1)
        if len(raw) > MAX_BODY:
            raise ValueError('executor_response_boundary')
        return json.loads(raw)

    completed = None
    while time.time()*1000 < config.get('expiresAtMs', float('inf')):
        try:
            proof = {**owner.check(starting=True), 'ownerSourceSha256': config['ownerSourceSha256']} if owner else None
            item = post('poll', {'shardSha256': config['shardSha256'], 'executableSha256': config['executableSha256'],
                                 **({'ownerProof': proof} if proof else {})})
            if item.get('idle') is True:
                time.sleep(1)
                continue
            if item.get('qualificationOnly') is not True or item.get('shardSha256') != config['shardSha256']:
                raise ValueError('executor_wrong_qualification_scope')
            remaining = (min(item['deadlineMs'], config.get('expiresAtMs', item['deadlineMs'])) - time.time()*1000) / 1000
            if remaining <= 0 or remaining > config.get('stageDeadlineMs', 180000)/1000:
                raise ValueError('executor_expired_ticket')
            if completed and completed['ticket'] == item['ticket']:
                # An uncertain result delivery must never recompute the model.
                post('result', completed)
                continue
            frame = unpack(item['frame'])
            h, tensors = read_frame(frame)
            if set(tensors) != set(config['inputIds']) or h.get('symbols', {}).get('s20') != 1:
                raise ValueError('executor_input_mismatch')
            started = time.monotonic()
            # CPU-only until a real GPU reservation guard is integrated and tested.
            result = {'ticket': item['ticket'], 'nodeId': config['nodeId'],
                      'shardSha256': config['shardSha256'], 'qualificationOnly': True}
            try:
                arguments = [config['executable'], config['shard'], 'cpu', '2']
                if config.get('mappedCpuWeights') is True:
                    arguments.append('mmap')
                if owner:
                    process = guarded_run(arguments, frame, remaining, owner)
                else:
                    process = subprocess.run(arguments,
                        input=frame, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=remaining)
                result['exitCode'] = process.returncode
                if process.returncode == 0:
                    try:
                        output, _ = read_frame(process.stdout)
                        result['frame'] = pack(process.stdout)
                        result['nativeMetrics'] = {k: output.get(k) for k in ('computeMs', 'device')}
                        result['nativeMetrics']['loadMode'] = 'mapped' if config.get('mappedCpuWeights') is True else 'copied'
                    except (ValueError, TypeError, KeyError):
                        result.update(exitCode=1, error='native_stage_invalid_output')
                else:
                    result['error'] = 'native_stage_failed'
            except subprocess.TimeoutExpired:
                result.update(exitCode=124, error='native_stage_deadline')
            except (ValueError, OSError, KeyError, TypeError):
                result.update(exitCode=125, error='native_owner_gate_closed')
            result['elapsedMs'] = (time.monotonic()-started)*1000
            completed = result
            post('result', completed)
        except (ValueError, KeyError, TimeoutError, OSError, subprocess.TimeoutExpired):
            # No credential, request, tensor or native stderr is logged.
            time.sleep(2)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config', required=True)
    p.add_argument('--executor', action='store_true')
    args = p.parse_args()
    config = json.loads(Path(args.config).read_bytes())
    validate_config(config, executor_mode=args.executor)
    if args.executor:
        executor(config)
    else:
        server(config).serve_forever()


if __name__ == '__main__':
    main()
