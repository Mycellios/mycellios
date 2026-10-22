"""Actual HTTP connection reuse and framing, without models or credentials."""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import unittest
from unittest.mock import patch
import urllib.error

from test_decision_native_pure import a, b, setup


class DecisionChannelTests(unittest.TestCase):
    def setUp(self):
        self.requests, self.ports, self.contexts = [], set(), []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                owner.requests.append((self.path, self.headers['Authorization'], json.loads(body)))
                owner.ports.add(self.client_address[1])
                raw = b'not-json' if self.path == '/bad-json' else b'{"ok":true}'
                self.send_response(409 if self.path == '/reject' else 200)
                self.send_header('Content-Length', '99' if self.path == '/oversize' else str(len(raw)))
                if self.path == '/close': self.send_header('Connection', 'close'); self.close_connection = True
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        def factory(_host, _port, *, context, timeout):
            self.contexts.append(context)
            return http.client.HTTPConnection(*self.server.server_address, timeout=timeout)

        self.context = object()
        self.client = a.JsonChannel('https://127.0.0.1', self.context, 'test-only', connection_factory=factory)

    def tearDown(self):
        self.client.close()
        self.server.shutdown(); self.server.server_close(); self.thread.join(2)

    def test_reuses_one_connection_and_authenticates_each_request(self):
        for i in range(3): self.assertEqual(self.client.post('/poll', {'sequence': i}, 3), {'ok': True})
        self.assertEqual(len(self.ports), 1)
        self.assertEqual(self.contexts, [self.context])
        self.assertEqual([x[1] for x in self.requests], ['Bearer test-only']*3)
        self.assertEqual([x[2]['sequence'] for x in self.requests], [0, 1, 2])

    def test_explicit_server_close_discards_connection(self):
        self.client.post('/close', {}, 3)
        self.assertIsNone(self.client.connection)
        self.client.post('/poll', {}, 3)
        self.assertEqual(len(self.ports), 2)

    def test_rejection_is_not_retried_and_keeps_error_code(self):
        with self.assertRaises(urllib.error.HTTPError) as caught: self.client.post('/reject', {}, 3)
        self.assertEqual(caught.exception.code, 409)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.client.post('/poll', {}, 3), {'ok': True})
        self.assertEqual(len(self.ports), 1)

    def test_bad_json_closes_the_channel(self):
        with self.assertRaises(ValueError): self.client.post('/bad-json', {}, 3)
        self.assertIsNone(self.client.connection)

    def test_oversized_declared_response_is_rejected_before_read(self):
        with patch.object(a.wire, 'MAX_BODY', 32):
            with self.assertRaisesRegex(ValueError, 'response_boundary'): self.client.post('/oversize', {}, 3)
        self.assertIsNone(self.client.connection)

    def test_oversized_request_never_connects(self):
        with patch.object(a.wire, 'MAX_BODY', 16):
            with self.assertRaisesRegex(ValueError, 'request_boundary'): self.client.post('/poll', {'data': 'x'*32}, 3)
        self.assertEqual(self.contexts, [])


class BrokerPersistentBoundaryTests(unittest.TestCase):
    def test_authentication_and_invalid_framing_close_before_reuse(self):
        config = setup(); config.update(address='127.0.0.1', port=0, certificate='unused', key='unused')
        broker = b.NativeDecisionBroker(config)
        with patch.object(b.ssl.SSLContext, 'load_cert_chain'), \
                patch.object(b.ssl.SSLContext, 'wrap_socket', side_effect=lambda sock, **kwargs: sock):
            server = broker.listener()
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for path, headers, data, expected in [
                ('/poll/0', {'Authorization': 'Bearer wrong'}, b'{}', 401),
                ('/unknown/0', {}, b'{}', 404),
                ('/poll/0', {'Authorization': 'Bearer '+'0'*64, 'Transfer-Encoding': 'chunked'}, b'0\r\n\r\n', 400),
            ]:
                connection = http.client.HTTPConnection(*server.server_address, timeout=3)
                try:
                    connection.request('POST', path, body=data, headers=headers)
                    response = connection.getresponse()
                    self.assertEqual(response.status, expected)
                    self.assertEqual(response.getheader('Connection'), 'close')
                    response.read()
                finally: connection.close()
        finally:
            server.shutdown(); server.server_close(); thread.join(2)


if __name__ == '__main__': unittest.main()
