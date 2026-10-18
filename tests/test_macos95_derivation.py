import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('derived95', ROOT / 'scripts/derive-macos95-source.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(os.environ.get('MACOS95_SOURCE_ARCHIVE'), 'existing authenticated public source required')
class DerivationTests(unittest.TestCase):
    def attempt(self, mutate=None, existing=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            patch = json.loads((ROOT / 'config/macos95-mac-patch.json').read_bytes())
            if mutate:
                mutate(patch)
            patch_file = root / 'patch.json'
            patch_file.write_text(json.dumps(patch), encoding='utf8')
            destination = root / 'payload'
            if existing:
                destination.mkdir()
                (destination / 'keep').write_text('keep')
            result = module.derive(Path(os.environ['MACOS95_SOURCE_ARCHIVE']),
                ROOT / 'config/macos95-source-allowlist.json', patch_file, destination)
            return result, json.loads((destination / 'mycellios-native-build-provenance.json').read_bytes())

    def test_four_mac_sources_have_new_identity_and651_authenticated_records(self):
        receipt, provenance = self.attempt()
        self.assertEqual(receipt['sourceId'], provenance['sourceId'])
        self.assertNotEqual(receipt['sourceId'], module.original.SOURCE_ID)
        self.assertEqual(len(provenance['files']), 651)
        self.assertEqual({item['path'] for item in receipt['files']}, module.ALLOWED)

    def test_changed_replacement_bytes_rejected(self):
        with self.assertRaisesRegex(ValueError, 'replacement_mismatch'):
            self.attempt(lambda value: value['files'][0].update(content='forged'))

    def test_derived_identity_cannot_be_borrowed(self):
        with self.assertRaisesRegex(ValueError, 'identity_mismatch'):
            self.attempt(lambda value: value.update(derivedSourceId=module.original.SOURCE_ID))

    def test_scope_cannot_include_another_source(self):
        with self.assertRaisesRegex(ValueError, 'scope_mismatch'):
            self.attempt(lambda value: value['files'][0].update(path='src/node/install-main.ts'))

    def test_existing_destination_is_preserved(self):
        with self.assertRaises(FileExistsError):
            self.attempt(existing=True)
