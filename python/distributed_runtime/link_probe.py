"""Bounded TCP link probe for physical multi-host evidence.

Laboratory tool, not a product entry module. One host runs ``serve`` and the
other runs ``measure``; the result is the round-trip time and bulk throughput
of a plain TCP connection in that direction. It measures the same transport
class the pipeline stages use, which matters where a host drops ICMP.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import socket
import struct
import sys
import time
from typing import Any

SCHEMA = "mycellios-link-probe/1"
PING = b"P"
BULK = b"B"
PING_BYTES = 32
MAX_BULK_BYTES = 256 * 1024 * 1024
CHUNK = 64 * 1024


def _receive_exact(connection: socket.socket, size: int) -> bytes:
    buffer = bytearray()
    while len(buffer) < size:
        chunk = connection.recv(size - len(buffer))
        if not chunk:
            raise ConnectionError("link probe peer closed the connection")
        buffer.extend(chunk)
    return bytes(buffer)


def _serve_connection(connection: socket.socket) -> None:
    while True:
        try:
            kind = connection.recv(1)
        except OSError:
            return
        if not kind:
            return
        if kind == PING:
            connection.sendall(PING + _receive_exact(connection, PING_BYTES))
        elif kind == BULK:
            (size,) = struct.unpack("!Q", _receive_exact(connection, 8))
            if size <= 0 or size > MAX_BULK_BYTES:
                return
            remaining = size
            while remaining:
                chunk = connection.recv(min(CHUNK, remaining))
                if not chunk:
                    return
                remaining -= len(chunk)
            connection.sendall(struct.pack("!Q", size))
        else:
            return


def serve(host: str, port: int, max_seconds: float, max_connections: int) -> int:
    deadline = time.monotonic() + max_seconds
    served = 0
    with socket.create_server((host, port), reuse_port=False) as server:
        print(json.dumps({"event": "ready", "host": host, "port": port}), flush=True)
        while served < max_connections:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            server.settimeout(remaining)
            try:
                connection, _ = server.accept()
            except socket.timeout:
                break
            with connection:
                connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                connection.settimeout(max(1.0, deadline - time.monotonic()))
                _serve_connection(connection)
            served += 1
    return 0


def _percentile(sorted_values: list[float], fraction: float) -> float:
    index = max(0, math.ceil(fraction * len(sorted_values)) - 1)
    return sorted_values[index]


def measure(host: str, port: int, samples: int, interval_ms: float, bulk_bytes: int, timeout: float) -> dict[str, Any]:
    if samples < 1 or samples > 10_000:
        raise ValueError("samples must be 1..10000")
    if bulk_bytes < 0 or bulk_bytes > MAX_BULK_BYTES:
        raise ValueError(f"bulk bytes must be 0..{MAX_BULK_BYTES}")
    rtts: list[float] = []
    lost = 0
    with socket.create_connection((host, port), timeout=timeout) as connection:
        connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        connection.settimeout(timeout)
        for index in range(samples):
            payload = struct.pack("!Q", index) + bytes(PING_BYTES - 8)
            started = time.perf_counter()
            try:
                connection.sendall(PING + payload)
                reply = _receive_exact(connection, 1 + PING_BYTES)
            except socket.timeout:
                lost += 1
                break
            elapsed = (time.perf_counter() - started) * 1000.0
            if reply != PING + payload:
                raise ConnectionError("link probe reply does not match the request")
            rtts.append(elapsed)
            if interval_ms > 0:
                time.sleep(interval_ms / 1000.0)
        bulk: dict[str, Any] | None = None
        if bulk_bytes and lost == 0:
            block = bytes(CHUNK)
            started = time.perf_counter()
            connection.sendall(BULK + struct.pack("!Q", bulk_bytes))
            remaining = bulk_bytes
            while remaining:
                piece = block[: min(CHUNK, remaining)]
                connection.sendall(piece)
                remaining -= len(piece)
            (acknowledged,) = struct.unpack("!Q", _receive_exact(connection, 8))
            elapsed = time.perf_counter() - started
            if acknowledged != bulk_bytes:
                raise ConnectionError("link probe bulk acknowledgement does not match")
            bulk = {"bytes": bulk_bytes, "seconds": elapsed, "mbitPerSecond": bulk_bytes * 8 / elapsed / 1e6}
    if not rtts:
        raise ConnectionError("link probe measured no round trip")
    ordered = sorted(rtts)
    return {
        "schema": SCHEMA,
        "transport": "tcp",
        "target": {"host": host, "port": port},
        "measuredAt": datetime.now(timezone.utc).isoformat(),
        "samples": len(rtts),
        "lost": lost,
        "rttMs": {
            "min": ordered[0],
            "mean": sum(ordered) / len(ordered),
            "p50": _percentile(ordered, 0.50),
            "p95": _percentile(ordered, 0.95),
            "max": ordered[-1],
        },
        "bulk": bulk,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bounded TCP link probe for physical evidence.")
    commands = parser.add_subparsers(dest="command", required=True)
    serve_parser = commands.add_parser("serve")
    serve_parser.add_argument("--host", required=True)
    serve_parser.add_argument("--port", type=int, required=True)
    serve_parser.add_argument("--max-seconds", type=float, default=120.0)
    serve_parser.add_argument("--max-connections", type=int, default=2)
    measure_parser = commands.add_parser("measure")
    measure_parser.add_argument("--host", required=True)
    measure_parser.add_argument("--port", type=int, required=True)
    measure_parser.add_argument("--samples", type=int, default=200)
    measure_parser.add_argument("--interval-ms", type=float, default=20.0)
    measure_parser.add_argument("--bulk-bytes", type=int, default=16 * 1024 * 1024)
    measure_parser.add_argument("--timeout-seconds", type=float, default=10.0)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "serve":
        if args.max_seconds <= 0 or args.max_seconds > 3600 or args.max_connections < 1 or args.max_connections > 16:
            raise SystemExit("serve bounds: max-seconds 0..3600, max-connections 1..16")
        return serve(args.host, args.port, args.max_seconds, args.max_connections)
    result = measure(args.host, args.port, args.samples, args.interval_ms, args.bulk_bytes, args.timeout_seconds)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
