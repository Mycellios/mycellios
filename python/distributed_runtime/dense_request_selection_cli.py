"""Bounded JSON interface for measured dense request planning.

The coordinator supplies authenticated observations and candidate receipts.
This interface selects a route; it never starts or redirects an active decoder.
"""
import json
import sys
import time

if __package__:
    from .dense_request_selection import select_dense_request_route
else:
    # The coordinator's metadata-only planner must not initialize Torch/ROCm.
    # Resolve only the adjacent pure-Python selector from the same package.
    import runpy
    from pathlib import Path
    select_dense_request_route = runpy.run_path(
        str(Path(__file__).with_name("dense_request_selection.py"))
    )["select_dense_request_route"]

MAX_INPUT_BYTES = 8 * 1024 * 1024


def select_request(document, *, now):
    if not isinstance(document, dict):
        raise ValueError("A planning object is required")
    fields = {"candidates", "devices", "context", "layer_count",
              "generated_tokens", "reference_output_sha256"}
    if set(document) != fields:
        raise ValueError("Exact planning fields required; clock and gates are runtime-owned")
    if not isinstance(document["candidates"], list) or not isinstance(document["devices"], list):
        raise ValueError("Candidate and device arrays required")
    return select_dense_request_route(**document, now=now)


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise ValueError("Planning input exceeds bounded size")
        document = json.loads(raw)
        result = select_request(document, now=time.time())
        json.dump(result, sys.stdout, allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except (ValueError, TypeError, KeyError, AttributeError):
        # Do not reflect potentially private receipts in process diagnostics.
        sys.stderr.write("Invalid dense request planning input\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
