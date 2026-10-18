"""Verify the existing public client95 archive before extracting any build code."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

ARCHIVE_SHA = '380edcd7d62db777587564a27bef6b313a3fb26dee4b9b3a8c4aa5526d2fc72d'
SOURCE_ID = 'sha256:df3c212976012758420b0085c8050ba417d818fc9424b4ec0a7edc1b42719032'
SOURCE_REVISION = '7e8ce6eaf9b0501c0424773ec94c8e4af94bd3c5'
ARCHIVE_URL = 'https://www.mycellios.com/downloads/mycellios-node-0.2.95-source.zip'


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def verify_archive(archive, allowlist):
    if archive.stat().st_size != 18246275 or hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA:
        raise ValueError('client95_archive_identity_mismatch')
    expected = json.loads(allowlist.read_text(encoding='utf-8'))
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if len(entries) != 956 or len({entry.filename.casefold() for entry in entries}) != 956:
            raise ValueError('client95_archive_inventory_mismatch')
        observed = []
        for entry in entries:
            name = entry.filename
            parts = PurePosixPath(name).parts
            if (entry.is_dir() or not parts or name.startswith('/') or '\\' in name
                    or any(part in ('.', '..') for part in name.split('/'))
                    or ':' in name or re.search(r'[\x00-\x1f\x7f]', name)
                    or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1
                    or entry.file_size > 32 * 1024**2
                    or re.search(r'android|poco|jarvis|owned-agent', name, re.IGNORECASE)):
                raise ValueError('client95_archive_entry_rejected:' + name)
            data = source.read(entry)
            observed.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        if observed != expected['files'] or expected['archiveSha256'] != ARCHIVE_SHA:
            raise ValueError('client95_entry_allowlist_mismatch')
        provenance = json.loads(source.read('mycellios-native-build-provenance.json'))
        identity = {key: provenance[key] for key in ('schema', 'version', 'files')}
        if (provenance['sourceId'] != SOURCE_ID or len(provenance['files']) != 651
                or provenance['version'] != '0.2.95'
                or 'sha256:' + hashlib.sha256(canonical(identity)).hexdigest() != SOURCE_ID):
            raise ValueError('client95_source_identity_mismatch')
        by_path = {row['path']: row for row in observed}
        if any(by_path.get(row['path']) != row for row in provenance['files']):
            raise ValueError('client95_provenance_file_mismatch')
        if json.loads(source.read('package.json'))['version'] != '0.2.95':
            raise ValueError('client95_package_version_mismatch')
        return observed


def extract_verified(archive, allowlist, destination):
    rows = verify_archive(archive, allowlist)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('client95_destination_already_exists')
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive) as source:
        for row in rows:
            target = destination.joinpath(*row['path'].split('/'))
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(source.read(row['path']))
    return {'schema': 'mycellios-archived-client-build-input/1', 'version': '0.2.95',
            'archiveUrl': ARCHIVE_URL, 'archiveSha256': ARCHIVE_SHA, 'sourceId': SOURCE_ID,
            'sourceRevision': SOURCE_REVISION, 'archiveFiles': len(rows), 'sourceRecords': 651,
            'scope': 'Archived payload identity; orchestration Git revision is recorded separately.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--allowlist', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    receipt = extract_verified(args.archive, args.allowlist, args.destination)
    with args.receipt.open('x', encoding='utf-8') as output:
        json.dump(receipt, output, indent=2)
