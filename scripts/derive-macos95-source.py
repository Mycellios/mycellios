"""Apply reviewed Mac-only replacements to the authenticated, immutable95 archive."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import zipfile

spec = importlib.util.spec_from_file_location('original95', Path(__file__).with_name('verify-macos95-source.py'))
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
ALLOWED = {'src/node/identity-store.ts', 'src/node/uninstall-executor.ts', 'src/node/service-registration.ts', 'src/node/main.ts', 'scripts/build-node-pkg.mjs', 'scripts/verify-node-pkg.mjs'}


def derive(archive, allowlist, patch_path, destination):
    rows = original.verify_archive(archive, allowlist)
    patch_bytes = patch_path.read_bytes()
    patch = json.loads(patch_bytes)
    if (patch['schema'] != 'mycellios-macos95-source-derivation/1'
            or patch['baseArchiveSha256'] != original.ARCHIVE_SHA
            or patch['baseSourceId'] != original.SOURCE_ID
            or len(patch['files']) != 6 or {item['path'] for item in patch['files']} != ALLOWED
            or len(patch.get('fixtures', [])) != 1
            or patch['fixtures'][0]['path'] != 'tests/node-pkg-package.test.ts'):
        raise ValueError('mac95_derivation_base_or_scope_mismatch')
    replacements = {}
    by_path = {row['path']: row for row in rows}
    with zipfile.ZipFile(archive) as source:
        provenance = json.loads(source.read('mycellios-native-build-provenance.json'))
        for item in patch['files'] + patch['fixtures']:
            before = by_path[item['path']]
            after = item['content'].encode('utf-8')
            if (before['sha256'] != item['beforeSha256'] or before['bytes'] != item['beforeBytes']
                    or len(after) != item['afterBytes']
                    or hashlib.sha256(after).hexdigest() != item['afterSha256']):
                raise ValueError('mac95_derivation_replacement_mismatch')
            replacements[item['path']] = after
            record = next((record for record in provenance['files'] if record['path'] == item['path']), None)
            if item['path'] == 'tests/node-pkg-package.test.ts':
                if record is not None:
                    raise ValueError('mac95_fixture_unexpectedly_in_source_identity')
                continue
            if record != before:
                raise ValueError('mac95_derivation_source_binding_mismatch')
            record.update(bytes=len(after), sha256=item['afterSha256'])
        identity = {key: provenance[key] for key in ('schema', 'version', 'files')}
        source_id = 'sha256:' + hashlib.sha256(original.canonical(identity)).hexdigest()
        if source_id != patch['derivedSourceId'] or source_id == original.SOURCE_ID:
            raise ValueError('mac95_derivation_identity_mismatch')
        provenance['sourceId'] = source_id
        replacements['mycellios-native-build-provenance.json'] = (json.dumps(provenance, indent=2, ensure_ascii=False) + '\n').encode()
        if destination.exists() or destination.is_symlink():
            raise FileExistsError('mac95_derivation_destination_exists')
        destination.mkdir(parents=True)
        for row in rows:
            target = destination.joinpath(*row['path'].split('/'))
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(replacements.get(row['path'], source.read(row['path'])))
    return {'schema': 'mycellios-macos95-derived-build-input/1',
            'baseArchiveSha256': original.ARCHIVE_SHA, 'baseSourceId': original.SOURCE_ID,
            'sourceId': source_id, 'sourceRevision': original.SOURCE_REVISION,
            'patchSha256': hashlib.sha256(patch_bytes).hexdigest(), 'sourceRecords': len(provenance['files']),
            'files': [{key: value for key, value in item.items() if key != 'content'} for item in patch['files']],
            'fixtures': [{key: value for key, value in item.items() if key != 'content'} for item in patch['fixtures']],
            'scope': 'Mac-only derived payload; original Windows95 and public source ZIP are unchanged.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('archive', 'allowlist', 'patch', 'destination', 'receipt'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    result = derive(args.archive, args.allowlist, args.patch, args.destination)
    with args.receipt.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)
