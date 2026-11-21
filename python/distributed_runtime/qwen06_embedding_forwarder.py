"""Private failover entry for the Qwen3-Embedding-0.6B replicas.

Listens on the control server's private address, admits only configured
client addresses, and relays each TCP connection to the first replica whose
`/health` reports ready, in configured priority order (GPU first, CPU
backups after). With no ready replica it answers HTTP 503
`no_replica_available` so callers back off instead of hanging.

Contract: specs/memory-embedding-qwen06/spec.md
"""
import argparse
import asyncio
import json
from pathlib import Path

_NO_REPLICA_BODY = b'{"error":{"code":"no_replica_available"}}'
NO_REPLICA = (b"HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nConnection: close\r\n"
              + b"Content-Length: " + str(len(_NO_REPLICA_BODY)).encode() + b"\r\n\r\n" + _NO_REPLICA_BODY)


async def probe(host, port, timeout=3.0):
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        try:
            writer.write(f"GET /health HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
            await writer.drain()
            # The replica closes after replying; headers and body may arrive separately.
            raw = await asyncio.wait_for(reader.read(), timeout)
            if len(raw) > 65536:
                return False
        finally:
            writer.close()
        head, _, body = raw.partition(b"\r\n\r\n")
        return head.split(b" ", 2)[1:2] == [b"200"] and json.loads(body).get("ready") is True
    except (OSError, asyncio.TimeoutError, ValueError):
        return False


class Forwarder:
    def __init__(self, backends, allowed, probe_fn=probe, hold_seconds=0.0, poll_seconds=1.0):
        self.backends = [(item["host"], int(item["port"])) for item in backends]
        # Relative speed of each replica: work is spread by active connections
        # per unit of weight, so a GPU takes most requests and CPUs share the rest.
        self.weights = {(item["host"], int(item["port"])): max(1, int(item.get("weight", 1))) for item in backends}
        self.active = {backend: 0 for backend in self.backends}
        # Backup replicas (far slower, e.g. a laptop CPU) only take work while
        # no regular replica is ready, so they add survival, not timeouts.
        self.backups = {(item["host"], int(item["port"])) for item in backends if item.get("backup")}
        self.allowed = set(allowed)
        self.probe = probe_fn
        # While every replica is briefly unavailable (a GPU cooling down),
        # hold the connection instead of answering 503 at once.
        self.hold_seconds, self.poll_seconds = hold_seconds, poll_seconds
        self.ready = []

    def ordered_ready(self):
        """Ready replicas, least loaded relative to their weight first; config order breaks ties."""
        rank = {backend: index for index, backend in enumerate(self.backends)}
        regular = [b for b in self.ready if b not in self.backups]
        pool = regular or [b for b in self.ready if b in self.backups]
        return sorted(pool, key=lambda b: ((self.active[b] + 1) / self.weights[b], rank[b]))

    async def refresh(self):
        results = await asyncio.gather(*(self.probe(host, port) for host, port in self.backends))
        self.ready = [backend for backend, ok in zip(self.backends, results) if ok]

    async def handle(self, reader, writer):
        peer = writer.get_extra_info("peername")
        try:
            if not peer or peer[0] not in self.allowed:
                return
            waited = 0.0
            # Wait for a regular replica first (a GPU may only be cooling);
            # backups take the request only if none returns within the hold.
            while not any(b not in self.backups for b in self.ready) and waited < self.hold_seconds:
                await asyncio.sleep(self.poll_seconds)
                waited += self.poll_seconds
            if not self.ready:
                return await self.reject(reader, writer)
            upstream = None
            chosen = None
            for host, port in self.ordered_ready():
                try:
                    upstream = await asyncio.wait_for(asyncio.open_connection(host, port), 5)
                    chosen = (host, port)
                    break
                except (OSError, asyncio.TimeoutError):
                    continue
            if upstream is None:
                return await self.reject(reader, writer)
            up_reader, up_writer = upstream

            async def pump(source, destination, client_side):
                try:
                    while chunk := await source.read(65536):
                        destination.write(chunk)
                        await destination.drain()
                    if client_side:
                        # HTTP clients never half-close while awaiting a reply;
                        # EOF means they gave up, so drop the replica connection
                        # and let it stop the abandoned work.
                        destination.close()
                    elif destination.can_write_eof():
                        destination.write_eof()
                except OSError:
                    pass

            self.active[chosen] += 1
            try:
                await asyncio.gather(pump(reader, up_writer, True), pump(up_reader, writer, False))
            finally:
                self.active[chosen] -= 1
                up_writer.close()
        finally:
            writer.close()

    async def reject(self, reader, writer):
        # Read the bounded request head first so the client receives the reply.
        try:
            await asyncio.wait_for(reader.read(65536), 2)
        except (OSError, asyncio.TimeoutError):
            pass
        writer.write(NO_REPLICA)
        await writer.drain()
        if writer.can_write_eof():
            writer.write_eof()


async def serve(config):
    forwarder = Forwarder(config["backends"], config["allowedClients"], hold_seconds=float(config.get("holdSeconds", 0)))

    async def health_loop():
        while True:
            await forwarder.refresh()
            await asyncio.sleep(5)

    asyncio.create_task(health_loop())
    server = await asyncio.start_server(forwarder.handle, config["host"], int(config["port"]))
    async with server:
        await server.serve_forever()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    asyncio.run(serve(json.loads(Path(parser.parse_args().config).read_text())))


if __name__ == "__main__":
    main()
