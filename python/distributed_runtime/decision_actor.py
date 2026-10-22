"""CPU actor for authenticated native subleases, with local and remote revocation."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import http.client
import io
import importlib.util
import ipaddress
import json
import logging
from logging.handlers import RotatingFileHandler
import math
import os
from pathlib import Path
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request
import urllib.parse

if __package__:
    from . import decision_owner as owner_module
    from . import decision_reverse as wire
    from . import decision_contract as contract
else:
    def sibling(name):
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
    owner_module, wire, contract = sibling('decision_owner'), sibling('decision_reverse'), sibling('decision_contract')


def file_pin(path, digest):
    file = Path(path)
    if file.is_symlink(): raise ValueError('decision_actor_symlink_rejected')
    h = hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1048576), b''): h.update(block)
    if not hmac.compare_digest(h.hexdigest(), digest): raise ValueError('decision_actor_artifact_changed')
    stat = file.stat()
    return stat.st_size, stat.st_mtime_ns


class JsonChannel:
    """One sequential authenticated channel; never replay an uncertain request."""
    def __init__(self, origin, context, token, *, connection_factory=None):
        self.origin, self.context, self.token = urllib.parse.urlsplit(origin), context, token
        self.factory = connection_factory or http.client.HTTPSConnection
        self.connection = None
        self.lock = threading.RLock()

    def close(self):
        with self.lock:
            if self.connection is not None:
                self.connection.close()
                self.connection = None

    def post(self, path, body, timeout):
        raw = json.dumps(body, allow_nan=False, separators=(',', ':')).encode()
        if not 0 < len(raw) <= wire.MAX_BODY:
            raise ValueError('decision_actor_request_boundary')
        with self.lock:
            try:
                if self.connection is None:
                    self.connection = self.factory(self.origin.hostname, self.origin.port,
                                                   context=self.context, timeout=timeout)
                connection = self.connection
                connection.timeout = timeout
                if connection.sock is not None: connection.sock.settimeout(timeout)
                connection.request('POST', path, body=raw, headers={
                    'Authorization': 'Bearer '+self.token, 'Content-Type': 'application/json',
                    'Content-Length': str(len(raw))})
                response = connection.getresponse()
                length = response.getheader('Content-Length')
                if response.getheader('Transfer-Encoding') or length is None \
                        or not length.isdecimal() or not 0 < int(length) <= wire.MAX_BODY:
                    raise ValueError('decision_actor_response_boundary')
                data = response.read(wire.MAX_BODY+1)
                if len(data) != int(length): raise ValueError('decision_actor_response_boundary')
                status, headers = response.status, response.headers
                if response.will_close: self.close()
                if status != 200:
                    raise urllib.error.HTTPError(self.origin.geturl()+path, status,
                                                 'native_decision_request_rejected', headers, io.BytesIO(data))
                return wire._json(data)
            except urllib.error.HTTPError:
                raise
            except (ValueError, OSError):
                self.close()
                raise
            except http.client.HTTPException as error:
                self.close()
                raise urllib.error.URLError(error) from error


class PermitGuard:
    def __init__(self, owner, post, item):
        self.owner, self.post, self.item = owner, post, item
        self.expires_at, self.refresh_at = 0, 0

    def check(self, *, starting=False):
        proof = self.owner.check(starting=starting)
        now = time.monotonic()
        if now >= self.item['_deadlineMonotonic']: raise ValueError('decision_native_lease_expired')
        if now >= self.refresh_at:
            try:
                requested_at = time.monotonic()
                permit = self.post('permit', {'ticket': self.item['ticket'], 'ownerProof': proof})
                expiry, server_now = permit.get('expiresAtMs'), permit.get('serverNowMs')
                if permit.get('authorized') is not True or type(expiry) not in (int, float) \
                        or type(server_now) not in (int, float) or not math.isfinite(server_now) \
                        or not server_now < expiry <= min(self.item['deadlineMs'], server_now+5000):
                    raise ValueError('decision_native_permit_invalid')
                # Subtract the entire round trip. A clock difference between PCs
                # must never invalidate a grant or extend its absolute lifetime.
                self.expires_at = min(self.item['_deadlineMonotonic'], requested_at+(expiry-server_now)/1000)
                self.refresh_at = time.monotonic()+1
            except urllib.error.HTTPError as error:
                self.expires_at = 0
                raise ValueError('decision_native_permit_revoked') from error
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                # A transport error cannot extend the last absolute grant.
                if self.expires_at <= time.monotonic(): raise ValueError('decision_native_permit_unavailable')
        if self.expires_at <= time.monotonic(): raise ValueError('decision_native_permit_expired')
        return proof


def run(config):
    if config.get('schema') != 'mycellios-native-decision-actor/1' or config.get('mode') not in ('qualification', 'serving') \
            or config.get('mappedCpuWeights') is not True or not config.get('serverUrl', '').startswith('https://') \
            or not isinstance(config.get('token'), str) or len(config['token']) < 64:
        raise ValueError('decision_actor_configuration')
    if config['mode'] == 'qualification' and not time.time()*1000 < config.get('expiresAtMs', 0) <= time.time()*1000+6*3600000:
        raise ValueError('decision_actor_qualification_expiry')
    url = urllib.parse.urlsplit(config['serverUrl'])
    if url.username or url.password or url.query or url.fragment or url.path or url.scheme != 'https' \
            or ipaddress.ip_address(url.hostname) not in ipaddress.ip_network('100.64.0.0/10') \
            or config.get('executableSha256') != contract.CORE_SHA256:
        raise ValueError('decision_actor_endpoint_or_core_binding')
    root = Path(__file__).parent
    diagnostic = logging.getLogger('mycellios.decision.actor')
    diagnostic.propagate = False
    if config.get('diagnostics') is True:
        log_path = root/'actor-events.jsonl'
        if log_path.is_symlink(): raise ValueError('decision_actor_diagnostic_symlink')
        handler = RotatingFileHandler(log_path, maxBytes=1024*1024, backupCount=1)
        handler.setFormatter(logging.Formatter('%(message)s'))
        diagnostic.addHandler(handler)
    pins = config['sourceFiles']
    if set(pins) != {'decision_actor.py', 'decision_owner.py', 'decision_reverse.py', 'decision_contract.py'}:
        raise ValueError('decision_actor_source_closure')
    for name, digest in pins.items(): file_pin(root/name, digest)
    snapshots = {path: file_pin(path, digest) for path, digest in (
        (config['executable'], config['executableSha256']), (config['shard'], config['shardSha256']))}
    owner = owner_module.DecisionOwnerGuard(config['ownerGuard'])
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cafile=config['serverCertificate'])
    context.minimum_version = ssl.TLSVersion.TLSv1_2

    def proof(): return {**owner.check(), 'ownerSourceSha256': pins['decision_owner.py']}

    channel = JsonChannel(config['serverUrl'], context, config['token'])

    def post(action, body, selected_channel=channel):
        body = {**body, 'shardSha256': config['shardSha256'], 'executableSha256': config['executableSha256']}
        if isinstance(body.get('ownerProof'), dict): body['ownerProof']['ownerSourceSha256'] = pins['decision_owner.py']
        return selected_channel.post('/'+action+'/'+config['nodeId'], body, 3 if action == 'permit' else 30)

    completed, last_diagnostic, unavailable = None, float('-inf'), False
    while config['mode'] == 'serving' or time.time()*1000 < config['expiresAtMs']:
        phase = 'poll'
        try:
            for path, expected in snapshots.items():
                stat = Path(path).stat()
                if (stat.st_size, stat.st_mtime_ns) != expected: raise ValueError('decision_actor_artifact_changed')
            polled_at = time.monotonic()
            item = post('poll', {'ownerProof': proof()})
            if unavailable:
                diagnostic.warning(json.dumps({'event': 'decision_actor_recovered', 'stageIndex': config['stageIndex']}))
                unavailable = False
            if item.get('idle') is True: time.sleep(1); continue
            if item.get('schema') != 'mycellios-native-decision-stage/1' or item.get('scope') != config['mode'] \
                    or item.get('nodeId') != config['nodeId'] or item.get('stageIndex') != config['stageIndex'] \
                    or item.get('shardSha256') != config['shardSha256'] \
                    or item.get('lease', {}).get('activationId') != config['activationId']:
                raise ValueError('decision_actor_scope_mismatch')
            if type(item.get('serverNowMs')) not in (int, float) or not math.isfinite(item['serverNowMs']):
                raise ValueError('decision_actor_server_time_required')
            remaining = (min(item['deadlineMs'], item['lease']['deadline'])-item['serverNowMs'])/1000 \
                - (time.monotonic()-polled_at)
            if not 0 < remaining <= 240: raise ValueError('decision_actor_deadline')
            item['_deadlineMonotonic'] = time.monotonic()+remaining
            if completed and completed['ticket'] == item['ticket']: post('result', completed); continue
            for path, expected in snapshots.items():
                stat = Path(path).stat()
                if (stat.st_size, stat.st_mtime_ns) != expected: raise ValueError('decision_actor_artifact_changed')
            phase = 'frame'
            frame = wire.unpack(item['frame']); h, tensors = wire.read_frame(frame)
            if set(tensors) != set(config['inputIds']) or h.get('symbols', {}).get('s20') != 1 \
                    or type(h.get('symbols', {}).get('s53')) is not int or not 1 <= h['symbols']['s53'] <= 256:
                raise ValueError('decision_actor_geometry')
            started = time.monotonic()
            result = {'ticket': item['ticket'], 'nodeId': config['nodeId'], 'shardSha256': config['shardSha256']}
            permit_channel = JsonChannel(config['serverUrl'], context, config['token'])
            phase = 'execution'
            try:
                native = owner_module.run_guarded([config['executable'], config['shard'], 'cpu', '2', 'mmap',
                    str(os.getpid()), str(max(1, int(remaining*1000)))],
                    frame, remaining, PermitGuard(owner,
                        lambda action, body: post(action, body, permit_channel), item))
                result['exitCode'] = native.returncode
                if native.returncode == 0:
                    out, values = wire.read_frame(native.stdout)
                    if set(values) != set(config['outputIds']): raise ValueError('decision_actor_output_binding')
                    result.update(frame=wire.pack(native.stdout), nativeMetrics={k: out.get(k) for k in ('computeMs', 'device')})
                else: result['error'] = 'native_stage_failed'
            except subprocess.TimeoutExpired: result.update(exitCode=124, error='native_stage_deadline')
            except (ValueError, TypeError, KeyError, OSError) as error:
                code = str(error) if isinstance(error, ValueError) and str(error).startswith('decision_') else type(error).__name__
                result.update(exitCode=125, error='native_owner_or_lease_closed', ownerFailureCode=code)
            finally:
                permit_channel.close()
            result['elapsedMs'] = (time.monotonic()-started)*1000
            completed = result
            phase = 'result'
            post('result', completed)
        except (ValueError, TypeError, KeyError, OSError) as error:
            unavailable = True
            if time.monotonic()-last_diagnostic >= 10:
                code = str(error)
                if not (code.startswith('decision_') and len(code) <= 100
                        and all(c.isascii() and (c.isalnum() or c == '_') for c in code)):
                    code = type(error).__name__
                diagnostic.warning(json.dumps({'event': 'decision_actor_unavailable',
                    'stageIndex': config['stageIndex'], 'phase': phase, 'code': code,
                    'httpStatus': error.code if isinstance(error, urllib.error.HTTPError) else None}))
                last_diagnostic = time.monotonic()
            time.sleep(2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--config', required=True)
    run(wire._json(Path(parser.parse_args().config).read_bytes()))
