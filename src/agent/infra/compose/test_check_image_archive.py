import importlib.util
import io
import pathlib
import tarfile
import unittest

spec = importlib.util.spec_from_file_location("image_policy", pathlib.Path(__file__).with_name("check-image-archive.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def archive(files, oci=False, compressed=False):
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w:gz" if compressed else "w", format=tarfile.USTAR_FORMAT) as layer:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            layer.addfile(entry, io.BytesIO(data))
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w") as outer:
        config = b'{"architecture":"amd64"}'
        meta = tarfile.TarInfo("config.json"); meta.size = len(config)
        outer.addfile(meta, io.BytesIO(config))
        entry = tarfile.TarInfo("blobs/sha256/example" if oci else "example/layer.tar")
        entry.size = len(payload.getvalue())
        outer.addfile(entry, io.BytesIO(payload.getvalue()))
    result.seek(0)
    return result


class ImagePolicyTests(unittest.TestCase):
    def test_rejects_sensitive_names(self):
        for name in ["app/.env", "app/.env.production", "app/.git/config", "root/.ssh/id_ed25519", "app/signing.pem", "app/signing.key"]:
            with self.subTest(name=name):
                self.assertIn(name, policy.inspect_archive(archive({name: b"example"}))[1])

    def test_allows_templates_and_excludes_dependencies(self):
        files = {"app/.env.example": b"PUBLIC_URL=example", "app/node_modules/fixture/.env": b"third-party fixture"}
        self.assertEqual(policy.inspect_archive(archive(files)), (1, []))

    def test_checks_private_key_bodies(self):
        header = b"-----BEGIN PRIVATE KEY-----"
        value = header + b"\n" + b"A" * 48
        self.assertEqual(policy.inspect_archive(archive({"app/fixture.txt": value}))[1], ["app/fixture.txt"])

    def test_literal_header_is_not_a_key(self):
        value = b'const header = "-----BEGIN PRIVATE KEY-----";\nconst body = undefined;'
        self.assertEqual(policy.inspect_archive(archive({"app/source.js": value}))[1], [])

    def test_supports_oci_plain_and_compressed_layers(self):
        for compressed in [False, True]:
            self.assertEqual(policy.inspect_archive(archive({"app/index.js": b"code"}, True, compressed)), (1, []))

    def test_refuses_archives_without_layers(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w"):
            pass
        data.seek(0)
        with self.assertRaises(ValueError):
            policy.inspect_archive(data)

    def test_refuses_unsafe_paths(self):
        with self.assertRaises(ValueError):
            policy.inspect_archive(archive({"../outside": b"example"}))

    def test_refuses_unknown_binary_blobs(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w") as outer:
            entry = tarfile.TarInfo("blobs/sha256/unknown")
            entry.size = 5
            outer.addfile(entry, io.BytesIO(b"\x28\xb5\x2f\xfd!"))
        data.seek(0)
        with self.assertRaises(ValueError):
            policy.inspect_archive(data)


if __name__ == "__main__":
    unittest.main()
