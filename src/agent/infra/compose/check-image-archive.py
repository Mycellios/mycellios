#!/usr/bin/env python3
"""Inspect saved image layers without extracting files or running the image."""
import re
import sys
import tarfile


class PrefixedReader:
    def __init__(self, prefix, stream):
        self.prefix = prefix
        self.stream = stream

    def read(self, size=-1):
        if size < 0:
            value, self.prefix = self.prefix, b""
            return value + self.stream.read()
        value, self.prefix = self.prefix[:size], self.prefix[size:]
        return value + self.stream.read(size - len(value))


def forbidden_name(name):
    if name.endswith(".example"):
        return False
    return bool(
        re.search(r"(^|/)\.git(/|$)", name)
        or re.search(r"(^|/)\.env(\.[^/]*)?$", name)
        or re.search(r"(^|/)id_(rsa|ecdsa|ed25519)$", name)
        or re.search(r"^app/.*\.(pem|key|p12|pfx)$", name)
    )


def contains_private_key(stream):
    header = re.compile(rb"-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----")
    pending = False
    for line in stream:
        line = line.rstrip(b"\r\n")
        if pending and len(line) >= 40 and re.fullmatch(rb"[A-Za-z0-9+/=]+", line):
            return True
        pending = bool(header.search(line))
    return False


def inspect_archive(stream):
    violations = set()
    layers = 0
    with tarfile.open(fileobj=stream, mode="r|*") as outer:
        for member in outer:
            if not member.isfile():
                continue
            source = outer.extractfile(member)
            head = source.read(512)
            # Docker legacy saves use layer.tar; OCI saves use digest-named blobs.
            is_layer = member.name.endswith("/layer.tar") or (
                "/blobs/" in "/" + member.name
                and (head.startswith(b"\x1f\x8b") or head[257:262] == b"ustar" or (head and not any(head)))
            )
            if not is_layer:
                if "/blobs/" in "/" + member.name and not head.lstrip().startswith((b"{", b"[")):
                    raise ValueError("Unsupported binary image blob; inspection must not skip layers")
                continue
            layers += 1
            with tarfile.open(fileobj=PrefixedReader(head, source), mode="r|*") as layer:
                for item in layer:
                    name = item.name.removeprefix("./").lstrip("/")
                    if ".." in name.split("/"):
                        raise ValueError("Unsafe image layer path")
                    if "node_modules" in name.split("/"):
                        continue
                    if forbidden_name(name):
                        violations.add(name)
                    if item.isfile() and name.startswith("app/"):
                        if contains_private_key(layer.extractfile(item)):
                            violations.add(name)
    if not layers:
        raise ValueError("No inspectable image layers found")
    return layers, sorted(violations)


if __name__ == "__main__":
    try:
        count, found = inspect_archive(sys.stdin.buffer)
        if found:
            print("Image contains files that must not ship:", file=sys.stderr)
            for name in found:
                print("  " + name, file=sys.stderr)
            sys.exit(1)
        print(f"Checked {count} image layers: no credentials or checkout state.")
    except (ValueError, tarfile.TarError, EOFError) as error:
        print(f"Image inspection failed: {error}", file=sys.stderr)
        sys.exit(1)
