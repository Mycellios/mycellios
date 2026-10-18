import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mac95', ROOT / 'scripts/verify-macos95-source.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceArchiveTests(unittest.TestCase):
    def test_canonical_identity_does_not_depend_on_object_key_order(self):
        self.assertEqual(module.canonical({'b': 2, 'a': [1]}), b'{"a":[1],"b":2}')

    def test_wrong_archive_rejected_before_destination_is_created(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'bad.zip'
            archive.write_bytes(b'not the pinned release')
            with self.assertRaisesRegex(ValueError, 'archive_identity'):
                module.extract_verified(archive, ROOT / 'config/macos95-source-allowlist.json', root / 'payload')
            self.assertFalse((root / 'payload').exists())

    @unittest.skipUnless(os.environ.get('MACOS95_SOURCE_ARCHIVE'), 'existing public archive required')
    def test_all956_files_and651_source_records_are_authenticated(self):
        rows = module.verify_archive(Path(os.environ['MACOS95_SOURCE_ARCHIVE']), ROOT / 'config/macos95-source-allowlist.json')
        self.assertEqual(len(rows), 956)

    @unittest.skipUnless(os.environ.get('MACOS95_SOURCE_ARCHIVE'), 'existing public archive required')
    def test_added_allowlist_entry_is_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            document = json.loads((ROOT / 'config/macos95-source-allowlist.json').read_text())
            document['files'].append({'path': 'unreviewed.py', 'bytes': 1, 'sha256': '0' * 64})
            allowlist = root / 'allowlist.json'
            allowlist.write_text(json.dumps(document))
            with self.assertRaisesRegex(ValueError, 'allowlist_mismatch'):
                module.extract_verified(Path(os.environ['MACOS95_SOURCE_ARCHIVE']), allowlist, root / 'payload')
            self.assertFalse((root / 'payload').exists())

    @unittest.skipUnless(os.environ.get('MACOS95_SOURCE_ARCHIVE'), 'existing public archive required')
    def test_extraction_never_overwrites_an_existing_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sentinel = root / 'sentinel'
            sentinel.write_text('keep')
            with self.assertRaises(FileExistsError):
                module.extract_verified(Path(os.environ['MACOS95_SOURCE_ARCHIVE']), ROOT / 'config/macos95-source-allowlist.json', root)
            self.assertEqual(sentinel.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
