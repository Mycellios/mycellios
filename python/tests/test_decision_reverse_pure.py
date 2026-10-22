import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import time
import unittest
from unittest.mock import patch, MagicMock
import zlib

path = Path(__file__).resolve().parents[1] / 'distributed_runtime' / 'decision_reverse.py'
spec = importlib.util.spec_from_file_location('decision_reverse', path)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)


def frame(header, raw=b''):
    text = json.dumps(header, separators=(',', ':')).encode()
    return struct.pack('<I', len(text)) + text + raw


class DecisionReverseTests(unittest.TestCase):
    def setUp(self):
        self.raw = m.make_frame({'s20': 1, 's53': 64}, {434: struct.pack('<ff', 1.0, 0.0), 2405: b'abcd'})

    def test_slow_tls_negotiation_does_not_block_other_heartbeats(self):
        host, connection, context = MagicMock(), MagicMock(), MagicMock()
        listener = host.socket
        host.get_request.return_value = (connection, ('127.0.0.1', 12345))
        with patch.object(m, 'QualificationServer', return_value=host), \
             patch.object(m.ssl, 'SSLContext', return_value=context):
            result = m.server({'nodes': {}, 'address': '127.0.0.1', 'port': 0,
                               'certificate': 'fixture.crt', 'key': 'fixture.key'})
            self.assertEqual(result.get_request(), (connection, ('127.0.0.1',12345)))
        context.wrap_socket.assert_called_once_with(listener,
            server_side=True, do_handshake_on_connect=False)
        connection.settimeout.assert_called_once_with(10)
        connection.do_handshake.assert_not_called()

    def test_failed_worker_start_releases_its_bounded_slot(self):
        host = m.QualificationServer.__new__(m.QualificationServer)
        host.slots = m.threading.BoundedSemaphore(1)
        with patch.object(m.ThreadingHTTPServer, 'process_request', side_effect=RuntimeError('fixture')):
            with self.assertRaises(RuntimeError):
                host.process_request(MagicMock(), ('127.0.0.1', 1))
        self.assertTrue(host.slots.acquire(blocking=False))

    def test_expiry_and_distinct_physical_identity_are_required(self):
        config = {'expiresAtMs': 2000, 'operatorSecret': 'a'*64,
                  'nodes': {'first': {'physicalIdentity': 'physical-one', 'token': 'b'*64},
                            'second': {'physicalIdentity': 'physical-two', 'token': 'c'*64}}}
        m.validate_config(config, executor_mode=False, now_ms=1000)
        config['nodes']['second']['physicalIdentity'] = 'physical-one'
        with self.assertRaises(ValueError):
            m.validate_config(config, executor_mode=False, now_ms=1000)
        config['nodes']['second']['physicalIdentity'] = 'physical-two'
        with self.assertRaises(ValueError):
            m.validate_config(config, executor_mode=False, now_ms=3000)

    def test_plaintext_transport_and_reused_credentials_are_rejected(self):
        with self.assertRaises(ValueError):
            m.validate_config({'expiresAtMs': 2000, 'serverUrl': 'https://invalid',
                               'token': 'a'*64, 'stageDeadlineMs': 240001}, executor_mode=True, now_ms=1000)
        with self.assertRaises(ValueError):
            m.validate_config({'expiresAtMs': 2000, 'serverUrl': 'https://invalid',
                               'token': 'a'*64, 'mappedCpuWeights': 'yes'}, executor_mode=True, now_ms=1000)
        with self.assertRaises(ValueError):
            m.validate_config({'expiresAtMs': 2000, 'serverUrl': 'http://invalid',
                               'token': 'a'*64}, executor_mode=True, now_ms=1000)
        with self.assertRaises(ValueError):
            m.validate_config({'expiresAtMs': 2000, 'operatorSecret': 'a'*64,
                               'nodes': {'first': {'physicalIdentity': 'one', 'token': 'a'*64}}},
                              executor_mode=False, now_ms=1000)

    def test_lossless_roundtrip_and_order(self):
        out = m.unpack(m.pack(self.raw))
        self.assertEqual(out, self.raw)
        header, tensors = m.read_frame(out)
        self.assertEqual(header['symbols'], {'s20': 1, 's53': 64})
        self.assertEqual(list(tensors), [434, 2405])

    def test_digest_mismatch_is_rejected(self):
        body = m.pack(self.raw)
        body['sha256'] = '0'*64
        with self.assertRaises(ValueError):
            m.unpack(body)

    def test_truncated_frame_is_rejected(self):
        for raw in (b'', b'123', self.raw[:-1]):
            with self.subTest(raw_length=len(raw)), self.assertRaises(ValueError):
                m.read_frame(raw)

    def test_duplicate_tensor_is_rejected(self):
        raw = frame({'tensors': [{'id': 1, 'bytes': 4}, {'id': 1, 'bytes': 4}]}, b'abcdefgh')
        with self.assertRaises(ValueError):
            m.read_frame(raw)

    def test_bool_id_and_size_are_rejected(self):
        for tid, size in ((True, 4), (1, True), (1, -1), (-1, 4)):
            with self.subTest(tid=tid,size=size), self.assertRaises(ValueError):
                m.read_frame(frame({'tensors': [{'id': tid, 'bytes': size}]}, b'abcd'))

    def test_trailing_tensor_bytes_are_rejected(self):
        with self.assertRaises(ValueError):
            m.read_frame(self.raw + b'x')

    def test_empty_and_oversized_arity_are_rejected(self):
        for tensors in ([], [{'id': i, 'bytes': 4} for i in range(17)]):
            with self.assertRaises(ValueError):
                m.read_frame(frame({'tensors': tensors}, b'x'*68))

    def test_duplicate_json_keys_are_rejected(self):
        text = b'{"tensors":[],"tensors":[{"id":1,"bytes":4}]}'
        with self.assertRaises(ValueError):
            m.read_frame(struct.pack('<I',len(text)) + text + b'abcd')

    def test_nonfinite_json_is_rejected(self):
        raw = frame({'symbols': {'s20': float('nan')}, 'tensors': [{'id': 1, 'bytes': 4}]}, b'abcd')
        with self.assertRaises(ValueError):
            m.read_frame(raw)

    def test_header_array_is_rejected(self):
        with self.assertRaises(ValueError):
            m.read_frame(frame([], b''))

    def test_compressed_trailing_stream_is_rejected(self):
        body = m.pack(self.raw)
        compressed = base64.b64decode(body['zlibBase64']) + zlib.compress(b'extra')
        body['zlibBase64'] = base64.b64encode(compressed).decode()
        with self.assertRaises(ValueError):
            m.unpack(body)

    def test_truncated_compressed_stream_is_rejected(self):
        body = m.pack(self.raw)
        body['zlibBase64'] = base64.b64encode(base64.b64decode(body['zlibBase64'])[:-1]).decode()
        with self.assertRaises(ValueError):
            m.unpack(body)

    def test_decompression_bomb_is_bounded(self):
        raw = b'x'*1025
        body = {'sha256': hashlib.sha256(raw).hexdigest(),
                'zlibBase64': base64.b64encode(zlib.compress(raw)).decode()}
        with patch.object(m, 'MAX_RAW', 1024), self.assertRaises(ValueError):
            m.unpack(body)

    def test_invalid_base64_is_rejected(self):
        with self.assertRaises(ValueError):
            m.unpack({'sha256': '0'*64, 'zlibBase64': '***'})

    def test_header_size_bound_is_enforced(self):
        with self.assertRaises(ValueError):
            m.read_frame(struct.pack('<I', m.MAX_HEADER+1) + b'x'*4)

    def test_uncertain_delivery_never_recomputes_native_stage(self):
        self._assert_uncertain_delivery(self.raw)

    def test_invalid_native_output_is_cached_as_failure_without_recomputation(self):
        self._assert_uncertain_delivery(b'malformed-native-output')

    def test_mapped_mode_is_local_cpu_only_and_keeps_idempotent_delivery(self):
        self._assert_uncertain_delivery(self.raw, mapped=True)

    def _assert_uncertain_delivery(self, native_output, mapped=False):
        class Finished(BaseException):
            pass

        class Response:
            def __init__(self, body):
                self.body = json.dumps(body).encode()
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def read(self, size):
                return self.body

        with tempfile.TemporaryDirectory() as tmp:
            binary, shard = Path(tmp)/'native.exe', Path(tmp)/'stage.gguf'
            binary.write_bytes(b'unit-fixture-not-executable')
            shard.write_bytes(b'unit-fixture-not-a-model')
            digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
            config = {'shard': str(shard), 'shardSha256': digest(shard),
                      'executable': str(binary), 'executableSha256': digest(binary),
                      'serverCertificate': 'unit-fixture-cert', 'serverUrl': 'https://relay.invalid',
                      'nodeId': 'unit-fixture-node', 'token': 'unit-fixture-token', 'inputIds': [434,2405],
                      'mappedCpuWeights': mapped}
            item = {'qualificationOnly': True, 'ticket': 'unit-fixture-ticket',
                    'shardSha256': config['shardSha256'], 'deadlineMs': time.time()*1000+30000,
                    'frame': m.pack(self.raw), 'device': 'cuda'}
            polls, posts = [], []

            def transport(request, **kwargs):
                if '/poll/' in request.full_url:
                    polls.append(request)
                    if len(polls) > 2:
                        raise Finished()
                    return Response(item)
                posts.append(json.loads(request.data))
                if len(posts) == 1:
                    raise OSError('uncertain delivery')
                return Response({'accepted': True})

            result = m.subprocess.CompletedProcess([], 0, native_output, b'')
            with patch.object(m.ssl, 'create_default_context'), \
                 patch.object(m.urllib.request, 'urlopen', side_effect=transport), \
                 patch.object(m.time, 'sleep'), \
                 patch.object(m.subprocess, 'run', return_value=result) as run, \
                 self.assertRaises(Finished):
                m.executor(config)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], [str(binary), str(shard), 'cpu', '2'] + (['mmap'] if mapped else []))
            self.assertEqual(posts[0], posts[1])
            self.assertEqual(posts[0]['exitCode'], 0 if native_output == self.raw else 1)

    def test_local_artifact_mutation_fails_before_network_or_native_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp)/'changed.gguf'
            file.write_bytes(b'changed')
            with patch.object(m.urllib.request, 'urlopen') as network, \
                 patch.object(m.subprocess, 'run') as native, self.assertRaises(ValueError):
                m.executor({'shard': str(file), 'shardSha256': '0'*64,
                            'executable': str(file), 'executableSha256': '0'*64})
            network.assert_not_called()
            native.assert_not_called()


if __name__ == '__main__':
    unittest.main()
