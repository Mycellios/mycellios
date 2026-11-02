"""Portable metadata coordinates from an already authenticated stage manifest."""
import re
from collections.abc import Mapping

_COMMIT = re.compile(r"[0-9a-f]{32,}")
_NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]*")


def stage_tokenizer_coordinates(model: Mapping[str, object]) -> tuple[str, str | None]:
    """Never fetch weights or reinterpret an arbitrary missing local directory."""
    source = model.get("source")
    revision = model.get("revision")
    commit = model.get("snapshotCommit")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("tokenizer model source is missing")
    if revision is not None and not isinstance(revision, str):
        raise ValueError("tokenizer model revision is invalid")
    if commit is not None and (not isinstance(commit, str) or not _COMMIT.fullmatch(commit)):
        raise ValueError("tokenizer snapshot commit is invalid")
    parts = source.replace("\\", "/").rstrip("/").split("/")
    if len(parts) >= 3 and parts[-2] == "snapshots" and parts[-3].startswith("models--"):
        if commit is None or parts[-1] != commit:
            raise ValueError("tokenizer cache coordinate differs from authenticated commit")
        names = parts[-3].removeprefix("models--").split("--")
        if len(names) not in (1, 2) or any(not _NAME.fullmatch(name) or ".." in name for name in names):
            raise ValueError("tokenizer cache repository coordinate is invalid")
        source = "/".join(names)
    # A resolved Hub commit is immutable even when the original revision was main.
    return source, commit if commit is not None else revision
