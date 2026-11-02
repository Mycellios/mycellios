"""Optional socket-local write policy; frame encoding and ordering are unchanged."""
from __future__ import annotations

import socket
import argparse
import math
import threading
from weakref import WeakKeyDictionary

_LIMITS: WeakKeyDictionary[socket.socket, int] = WeakKeyDictionary()
_LOCK = threading.Lock()


def validate_write_chunk_bytes(value: int | None) -> None:
    if value is not None and (type(value) is not int or not 64 <= value <= 1048576):
        raise ValueError("TCP write chunk bytes must be an integer between 64 and 1048576")


def add_tcp_write_arguments(parser: argparse.ArgumentParser) -> None:
    def argument(value: str) -> int:
        try:
            size = int(value)
            validate_write_chunk_bytes(size)
            return size
        except ValueError as error:
            raise argparse.ArgumentTypeError(str(error)) from error
    parser.add_argument("--tcp-write-chunk-bytes", type=argument, default=None)


def validate_transport_limits(config: object, *timeouts: str, non_negative_first: bool = False) -> None:
    validate_write_chunk_bytes(getattr(config, "tcp_write_chunk_bytes", None))
    groups = [(timeouts, True), (("one_way_delay_ms", "bandwidth_mbps"), False)]
    if non_negative_first:
        groups.reverse()
    for names, positive in groups:
        for name in names:
            value = getattr(config, name)
            if not math.isfinite(value) or (value <= 0 if positive else value < 0):
                condition = "positive" if positive else "non-negative"
                raise ValueError(f"{name} must be finite and {condition}")


def configure_write_chunk_bytes(sock: socket.socket, value: int | None) -> None:
    validate_write_chunk_bytes(value)
    with _LOCK:
        if value is None:
            _LIMITS.pop(sock, None)
        else:
            _LIMITS[sock] = value


def send_frame_bytes(sock: socket.socket, header: bytes, payload: bytes | bytearray | memoryview) -> None:
    with _LOCK:
        try:
            limit = _LIMITS.get(sock)
        except TypeError:
            # Existing unhashable test doubles retain the default bulk policy.
            limit = None
    for source in (header, payload):
        if not source:
            continue
        if limit is None:
            sock.sendall(source)
        else:
            view = memoryview(source).cast("B")
            for offset in range(0, len(view), limit):
                sock.sendall(view[offset:offset + limit])
