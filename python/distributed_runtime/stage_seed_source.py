"""Ask the local Mycellios worker for a coordinator-planned seed blob.

The worker fetches the blob from a peer seed over an authorized runtime stream
and publishes it into this cache only after its own SHA-256 match. The stage
cache verifies it again before use and falls back to its origin on any
failure. Nothing here loads a model or sends request content.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request


SEED_TOKEN_ENVIRONMENT = "MYCELLIOS_ARTIFACT_SEED_TOKEN"
SEED_TOKEN_HEADER = "x-mycellios-seed-token"
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")
_MAX_RESPONSE_BYTES = 4096


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return None


@dataclass(frozen=True, slots=True)
class StageSeedSource:
    """A loopback-only worker endpoint plus its per-process token."""

    endpoint: str
    token: str
    minimum_bytes_per_second: int = 1024 * 1024
    base_timeout_seconds: float = 60.0

    def __post_init__(self) -> None:
        parsed = urllib.parse.urlsplit(self.endpoint)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or parsed.port is None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError("seed endpoint must be http://127.0.0.1:<port>")
        if not _TOKEN.match(self.token):
            raise ValueError("seed token is malformed")

    @classmethod
    def from_environment(
        cls, endpoint: str | None, environment: dict[str, str] | None = None
    ) -> "StageSeedSource | None":
        if not endpoint:
            return None
        token = (environment if environment is not None else dict(os.environ)).get(
            SEED_TOKEN_ENVIRONMENT
        )
        if not token:
            return None
        try:
            return cls(endpoint=endpoint, token=token)
        except ValueError:
            return None

    def fetch(self, digest: str, size_bytes: int) -> bool:
        """Return True only if the worker reports the blob published locally."""

        if not _DIGEST.match(digest) or size_bytes <= 0:
            return False
        base = self.endpoint.rstrip("/")
        request = urllib.request.Request(
            f"{base}/v1/artifact-seed/blobs/{digest}?sizeBytes={size_bytes}",
            method="POST",
            headers={SEED_TOKEN_HEADER: self.token, "Content-Length": "0"},
            data=b"",
        )
        timeout = self.base_timeout_seconds + size_bytes / self.minimum_bytes_per_second
        opener = urllib.request.build_opener(_NoRedirect())
        try:
            with opener.open(request, timeout=timeout) as response:
                if response.status != 200:
                    return False
                body = response.read(_MAX_RESPONSE_BYTES + 1)
        except (urllib.error.URLError, OSError, ValueError):
            return False
        if len(body) > _MAX_RESPONSE_BYTES:
            return False
        try:
            document = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False
        return isinstance(document, dict) and document.get("ok") is True


__all__ = ["SEED_TOKEN_ENVIRONMENT", "SEED_TOKEN_HEADER", "StageSeedSource"]
