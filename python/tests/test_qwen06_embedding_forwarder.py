import asyncio
import unittest

from distributed_runtime import qwen06_embedding_forwarder as forwarder_module


async def echo_backend(tag):
    async def handle(reader, writer):
        data = await reader.read(1024)
        writer.write(tag + b":" + data)
        await writer.drain()
        writer.close()
    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


async def request(port, payload=b"ping"):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(payload)
    await writer.drain()
    writer.write_eof()
    try:
        data = await reader.read()
    except ConnectionResetError:
        data = b""  # a rejected client may see a reset instead of a clean close
    writer.close()
    return data


class ForwarderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.gpu, gpu_port = await echo_backend(b"gpu")
        self.cpu, cpu_port = await echo_backend(b"cpu")
        self.health = {gpu_port: True, cpu_port: True}
        backends = [{"host": "127.0.0.1", "port": gpu_port}, {"host": "127.0.0.1", "port": cpu_port}]
        self.ports = (gpu_port, cpu_port)

        async def fake_probe(host, port):
            return self.health[port]
        self.forwarder = forwarder_module.Forwarder(backends, ["127.0.0.1"], probe_fn=fake_probe)
        self.server = await asyncio.start_server(self.forwarder.handle, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        for server in (self.server, self.gpu, self.cpu):
            server.close()
            await server.wait_closed()

    async def test_prefers_first_ready_backend_and_fails_over(self):
        await self.forwarder.refresh()
        self.assertEqual(await request(self.port), b"gpu:ping")
        self.health[self.ports[0]] = False
        await self.forwarder.refresh()
        self.assertEqual(await request(self.port), b"cpu:ping")

    async def test_spreads_work_by_weighted_load(self):
        gpu, cpu = ("127.0.0.1", self.ports[0]), ("127.0.0.1", self.ports[1])
        self.forwarder.weights = {gpu: 4, cpu: 1}
        await self.forwarder.refresh()
        self.assertEqual(self.forwarder.ordered_ready()[0], gpu)
        self.forwarder.active[gpu] = 4
        self.assertEqual(self.forwarder.ordered_ready()[0], cpu)
        self.forwarder.active[cpu] = 1
        self.assertEqual(self.forwarder.ordered_ready()[0], gpu)

    async def test_holds_a_request_until_a_replica_becomes_ready(self):
        self.health = {port: False for port in self.ports}
        await self.forwarder.refresh()
        self.forwarder.hold_seconds, self.forwarder.poll_seconds = 2.0, 0.05

        async def recover():
            await asyncio.sleep(0.2)
            self.health[self.ports[1]] = True
            await self.forwarder.refresh()
        asyncio.create_task(recover())
        self.assertEqual(await request(self.port), b"cpu:ping")

    async def test_answers_503_when_no_replica_is_ready(self):
        self.health = {port: False for port in self.ports}
        await self.forwarder.refresh()
        response = await request(self.port)
        self.assertTrue(response.startswith(b"HTTP/1.1 503"))
        self.assertIn(b"no_replica_available", response)
        head, _, body = response.partition(b"\r\n\r\n")
        length = int(next(line.split(b":")[1] for line in head.split(b"\r\n") if line.lower().startswith(b"content-length")))
        self.assertEqual(length, len(body))

    async def test_rejects_clients_outside_the_allowlist(self):
        self.forwarder.allowed = {"10.0.0.1"}
        await self.forwarder.refresh()
        self.assertEqual(await request(self.port), b"")


if __name__ == "__main__":
    unittest.main()
