"""Promote qualified first-party installers; the Android key stays on its host."""
import argparse, base64, copy, fcntl, hashlib, json, os, re, shutil, subprocess, urllib.request, zipfile
from pathlib import Path

REPO = 'Mycellios/mycellios'
SIGNER = '55121c1851944597566e2ccd0f87590cf2fa7e36acded7c8003627edcb39016c'
IDS = {'windows-x64': ('EXE', 'windows-x64-pilot.exe'), 'linux-x64': ('DEB', 'linux-x64-pilot.deb'),
       'fedora-x64': ('RPM', 'fedora-x86_64.rpm'), 'macos-arm64': ('DMG', 'macos-arm64-preview.dmg'),
       'macos-x64': ('DMG', 'macos-x64-preview.dmg')}

def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def version(value):
    if not isinstance(value, str) or not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', value):
        raise ValueError('Invalid release version')
    return tuple(map(int, value.split('.')))

def asset(value):
    if not isinstance(value, dict) or not re.fullmatch(r'[A-Za-z0-9._-]{1,220}', value.get('fileName', '')) \
       or '..' in value['fileName'] or not re.fullmatch(r'[a-f0-9]{64}', value.get('sha256', '')) \
       or type(value.get('bytes')) is not int or not 0 < value['bytes'] <= 2_000_000_000:
        raise ValueError('Invalid immutable asset')
    return value

def validate_manifest(m):
    if m.get('schema') != 'mycellios-installer-release/1' or m.get('automaticUpdates') is not False \
       or not re.fullmatch('[a-f0-9]{40}', m.get('revision', '')) \
       or not re.fullmatch('[a-f0-9]{40}', m.get('tree', '')) or type(m.get('workflowRun')) is not int or m['workflowRun'] < 1:
        raise ValueError('Unqualified release manifest')
    major, minor, patch = version(m.get('version'))
    if major > 1999 or minor > 999 or patch > 999:
        raise ValueError('Android version bounds exceeded')
    packages = m.get('platforms', [])
    if len(packages) != len(IDS) or {p.get('id') for p in packages} != set(IDS):
        raise ValueError('Incomplete native platform set')
    for p in packages:
        asset(p)
        fmt, suffix = IDS[p['id']]
        if p.get('version') != m['version'] or p.get('format') != fmt \
           or p['fileName'] != f"Mycellios-Desktop-{m['version']}-{suffix}":
            raise ValueError('Native installer substituted')
    source = asset(m.get('source'))
    if source['fileName'] != f"Mycellios-Desktop-{m['version']}-source-{m['revision'][:8]}.tar.gz":
        raise ValueError('Source archive differs')
    a = m.get('android', {})
    asset(a.get('input'))
    if a['input']['bytes'] >= 499_000_000:
        raise ValueError('Android build exceeds its public download contract')
    asset(a.get('buildReceipt'))
    if a['buildReceipt']['fileName'] != 'android-build.json' or a['buildReceipt']['bytes'] > 4_000_000:
        raise ValueError('Invalid Android web receipt')
    if a.get('applicationId') != 'com.mycellios.android' or a.get('minSdk') != 26 \
       or a.get('version') != f'{major+1}.{minor}.{patch}' \
       or a.get('versionCode') != 100_000 + major * 1_000_000 + minor * 1000 + patch \
       or a.get('signerSha256') != SIGNER or a['input']['fileName'] != 'android-build-input.apk':
        raise ValueError('Android identity or signing continuity differs')
    return m

def catalog_plan(m, originals):
    validate_manifest(m)
    source = {'path': f"/downloads/desktop/releases/{m['version']}/{m['source']['fileName']}", 'sha256': m['source']['sha256']}
    offered = {p['id']: p for p in m['platforms']}
    result = {}
    for name, original in originals.items():
        c = copy.deepcopy(original)
        if c.get('schema') != 'mycellios-desktop-downloads/1' or c.get('automaticUpdates') is not False:
            raise ValueError('Catalog policy changed')
        if version(c['version']) > version(m['version']) or any(version(p.get('version', c['version'])) > version(m['version']) for p in c['packages']):
            raise ValueError('A newer installer is already published')
        def package(old):
            p = offered[old['id']]
            url = f"/downloads/desktop/releases/{m['version']}/{p['fileName']}"
            if p['id'] == 'windows-x64':
                url += '?sha256=' + p['sha256']
            return {**old, **p, 'path': url, 'source': source}
        c['packages'] = [package(p) for p in c['packages']]
        if c.get('fedora') is not None or name == 'catalog-macos-all.json':
            old = c.get('fedora', {'id': 'fedora-x64'})
            if version(old.get('version', original['version'])) > version(m['version']):
                raise ValueError('A newer Fedora package is already published')
            c['fedora'] = package(old)
        c.update(version=m['version'], source=source)
        result[name] = c
    return result

def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + '.installer-pending')
    with tmp.open('w') as f:
        json.dump(value, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
    tmp.chmod(0o644); os.replace(tmp, path)

def recover_journal(journal, allowed):
    if not journal.exists():
        return
    saved = json.loads(journal.read_text())
    if saved.get('state') != 'pending':
        return
    for item in saved['pointers']:
        target = Path(item['path'])
        if str(target) not in allowed or digest(target) not in [item['beforeHash'], item['afterHash']]:
            raise ValueError('Concurrent publication; pointer recovery stopped')
    for item in saved['pointers']:
        target = Path(item['path'])
        atomic_json(target, json.loads(base64.b64decode(item['after'])))
    saved['state'] = 'committed'; atomic_json(journal, saved)

def promote_pointers(journal, values):
    pointers = []
    for target, after in values.items():
        target = Path(target); before = target.read_bytes()
        encoded = (json.dumps(after, indent=2) + '\n').encode()
        pointers.append({'path': str(target), 'before': base64.b64encode(before).decode(), 'beforeHash': hashlib.sha256(before).hexdigest(),
                         'after': base64.b64encode(encoded).decode(), 'afterHash': hashlib.sha256(encoded).hexdigest()})
    atomic_json(journal, {'state': 'pending', 'pointers': pointers})
    recover_journal(journal, {p['path'] for p in pointers})

def rollback_pointers(journal):
    saved = json.loads(journal.read_text())
    for item in saved['pointers']:
        if digest(item['path']) != item['afterHash']:
            raise ValueError('Concurrent publication; rollback stopped')
    for item in saved['pointers']:
        atomic_json(item['path'], json.loads(base64.b64decode(item['before'])))
    saved['state'] = 'rolled-back'; atomic_json(journal, saved)

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        from urllib.parse import urlparse
        url = urlparse(newurl)
        if url.scheme != 'https' or url.hostname not in ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'www.mycellios.com']:
            raise ValueError('Release redirect is not an official artifact host')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def response(url):
    return urllib.request.build_opener(SafeRedirect()).open(urllib.request.Request(url, headers={'User-Agent': 'MycelliosInstallerPublisher/1'}), timeout=60)

def json_url(url):
    with response(url) as r:
        body = r.read(4_000_001)
    if len(body) > 4_000_000:
        raise ValueError('Release metadata exceeds its limit')
    return json.loads(body)

def download(url, target, expected):
    asset(expected)
    if target.exists():
        if target.is_symlink() or target.stat().st_size != expected['bytes'] or digest(target) != expected['sha256']:
            raise ValueError('Immutable release file already exists with other bytes')
        return
    tmp = target.with_name(target.name + '.partial')
    h = hashlib.sha256(); size = 0
    with response(url) as r, tmp.open('wb') as f:
        while block := r.read(1_048_576):
            size += len(block)
            if size > expected['bytes']:
                raise ValueError('Download exceeded its admitted size')
            h.update(block); f.write(block)
        f.flush(); os.fsync(f.fileno())
    if size != expected['bytes'] or h.hexdigest() != expected['sha256']:
        raise ValueError('Downloaded installer digest differs')
    os.replace(tmp, target)

def public_file(source, target):
    if target.exists():
        if digest(source) != digest(target):
            raise ValueError('Refusing to replace a published release file')
        return
    target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copyfile(source, target)
    target.chmod(0o644)

def probe_public(url, original):
    req = urllib.request.Request(url, headers={'Range':'bytes=0-1023', 'User-Agent':'MycelliosInstallerPublisher/1'})
    with urllib.request.build_opener(SafeRedirect()).open(req, timeout=45) as r, original.open('rb') as f:
        expected = f.read(1024)
        if r.status != 206 or r.headers.get('Content-Range') != f'bytes 0-{len(expected)-1}/{original.stat().st_size}' or r.read(1025) != expected:
            raise ValueError('Public installer bytes did not pass the download probe')

def sign_android(config, stage, a):
    jar, keys = Path(config['signerJar']), Path(config['signingKeys'])
    if digest(jar) != config['signerJarSha256'] or any(not (keys/n).is_file() or (keys/n).is_symlink() or (keys/n).stat().st_mode & 0o077 for n in ['release.p12', 'password']):
        raise ValueError('Original signing material is unavailable or not private')
    output = stage/'signed'; output.mkdir(mode=0o700, exist_ok=True)
    apk = output/f"Mycellios-Android-{a['version']}.apk"
    cmd = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=384m', '--cpus=1', '--pids-limit=128', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--entrypoint', 'java', '-v', str(jar.parent)+':/tools:ro', '-v', str(stage)+':/in:ro', '-v', str(output)+':/out:rw', '-v', str(keys)+':/run/sign:ro', config['signerImage'], '-Xmx192m', '-jar', '/tools/'+jar.name]
    if not apk.exists():
        subprocess.run(cmd+['sign', '--ks', '/run/sign/release.p12', '--ks-pass', 'file:/run/sign/password', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true', '--v4-signing-enabled', 'false', '--min-sdk-version', '26', '--out', '/out/'+apk.name, '/in/android-build-input.apk'], check=True, timeout=180, capture_output=True)
    verified = subprocess.check_output(cmd+['verify', '--verbose', '--print-certs', '/out/'+apk.name], text=True, timeout=90)
    found = re.search(r'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)', verified)
    if not found or found[1].lower() != SIGNER or 'Verified using v2 scheme (APK Signature Scheme v2): true' not in verified or 'Verified using v3 scheme (APK Signature Scheme v3): true' not in verified:
        raise ValueError('APK does not preserve the original release signer')
    return apk

def verify_android_web(apk, receipt, manifest):
    a = manifest['android']
    if receipt.get('revision') != manifest['revision'] or receipt.get('tree') != manifest['tree'] \
       or receipt.get('version') != a['version'] or receipt.get('versionCode') != a['versionCode'] \
       or receipt.get('applicationId') != 'com.mycellios.android':
        raise ValueError('APK web receipt belongs to another source')
    files = receipt.get('sharedWebFiles', {})
    if not isinstance(files, dict) or not 1 <= len(files) <= 20_000:
        raise ValueError('APK has no qualified web assets')
    for name, sha in files.items():
        if not isinstance(name, str) or name.startswith('/') or '\\' in name or '..' in name.split('/') or not re.fullmatch('[a-f0-9]{64}', sha):
            raise ValueError('Invalid APK web asset path')
    with zipfile.ZipFile(apk) as z:
        entries = [i for i in z.infolist() if i.filename.startswith('assets/web/') and not i.is_dir()]
        if len(entries) != len(files) or len({i.filename for i in entries}) != len(entries) or sum(i.file_size for i in entries) > 268_435_456:
            raise ValueError('APK includes stale or unqualified web resources')
        for i in entries:
            name = i.filename[len('assets/web/'):]
            if name not in files or i.file_size > 67_108_864:
                raise ValueError('APK web resource exceeds its bound')
            h = hashlib.sha256()
            with z.open(i) as f:
                while block := f.read(1_048_576): h.update(block)
            if h.hexdigest() != files[name]:
                raise ValueError('APK does not contain the qualified shared application')
        index = z.getinfo('assets/web-files.json')
        if index.file_size > 4_000_000 or json.loads(z.read(index)) != sorted(files):
            raise ValueError('APK asset index differs')

def once(config):
    state, desktop, android = (Path(config[k]) for k in ['state', 'desktopRoot', 'androidRoot'])
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = Path(config['promotionLock']).open('a'); fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
    names = ['catalog.json', 'catalog-macos.json', 'catalog-macos-all.json']
    allowed = {str(desktop/n) for n in names}|{str(android/'latest.json')}
    recover_journal(state/'promotion.json', allowed)
    releases = json_url(f'https://api.github.com/repos/{REPO}/releases?per_page=5')
    for release in releases:
        metadata = next((a for a in release.get('assets', []) if a['name']=='installer-release.json'), None)
        if release.get('draft') or release.get('author', {}).get('login') != 'github-actions[bot]' or not metadata:
            continue
        tag = release['tag_name']
        if not re.fullmatch(r'desktop-v\d+\.\d+\.\d+-windows-preview', tag):
            continue
        base = f'https://github.com/{REPO}/releases/download/{tag}/'
        m = validate_manifest(json_url(base+'installer-release.json'))
        if tag != f"desktop-v{m['version']}-windows-preview":
            raise ValueError('Release tag differs from its manifest')
        completed = state/(m['revision']+'.json')
        if completed.exists():
            return
        run = json_url(f"https://api.github.com/repos/{REPO}/actions/runs/{m['workflowRun']}")
        if run.get('conclusion') == 'cancelled':
            return
        if run.get('head_sha') != m['revision'] or run.get('path', '').split('@')[0] != '.github/workflows/installer-release.yml' or run.get('head_repository', {}).get('full_name') != REPO:
            raise ValueError('Only the trusted release workflow may promote')
        jobs = json_url(f"https://api.github.com/repos/{REPO}/actions/runs/{m['workflowRun']}/jobs?per_page=100")
        published = [j for j in jobs.get('jobs', []) if j.get('name') == 'publish']
        if len(published) != 1 or published[0].get('conclusion') != 'success':
            return  # The final workflow health job waits for this host's promotion.
        ref = json_url(f'https://api.github.com/repos/{REPO}/git/ref/tags/{tag}')
        if ref.get('object', {}).get('type') != 'commit' or ref['object']['sha'] != m['revision']:
            raise ValueError('Published source tag moved')
        comparison = json_url(f"https://api.github.com/repos/{REPO}/compare/{m['revision']}...main")
        if comparison.get('status') not in ['ahead', 'identical']:
            raise ValueError('Release source is not integrated')
        originals = {n: json.loads((desktop/n).read_text()) for n in names}
        plan = catalog_plan(m, originals)
        inputs = m['platforms']+[m['source'], m['android']['input'], m['android']['buildReceipt']]
        for p in inputs:
            remote = [a for a in release['assets'] if a['name']==p['fileName']]
            if len(remote)!=1 or remote[0].get('size')!=p['bytes'] or remote[0].get('digest')!='sha256:'+p['sha256']:
                raise ValueError('GitHub artifact receipt differs')
        stage = state/m['revision']; stage.mkdir(mode=0o700, exist_ok=True)
        missing = sum(p['bytes'] for p in inputs if not (stage/p['fileName']).exists())
        if shutil.disk_usage(state).free < missing*2+536_870_912:
            raise ValueError('Insufficient space for staging and retained rollback')
        for p in inputs:
            download(base+p['fileName'], stage/p['fileName'], p)
        web_receipt = json.loads((stage/'android-build.json').read_text())
        verify_android_web(stage/'android-build-input.apk', web_receipt, m)
        apk = sign_android(config, stage, m['android'])
        if apk.stat().st_size >= 500_000_000:
            raise ValueError('Signed APK exceeds its public download contract')
        verify_android_web(apk, web_receipt, m)
        for p in m['platforms']+[m['source']]:
            public_file(stage/p['fileName'], desktop/'releases'/m['version']/p['fileName'])
        for p in m['platforms']:
            url = f"https://www.mycellios.com/downloads/desktop/releases/{m['version']}/{p['fileName']}"
            if p['id'] == 'windows-x64':
                url += '?sha256='+p['sha256']
            probe_public(url, stage/p['fileName'])
        old_android = json.loads((android/'latest.json').read_text()); a = m['android']
        if old_android['signerSha256'] != SIGNER:
            raise ValueError('Android current signing authority changed')
        values = {desktop/n:c for n,c in plan.items()}
        if a['versionCode'] > old_android['versionCode']:
            public_file(apk, android/'releases'/a['version']/apk.name)
            public_file(stage/m['source']['fileName'], android/'releases'/a['version']/'source.tar.gz')
            probe_public(f"https://www.mycellios.com/downloads/android/releases/{a['version']}/{apk.name}", apk)
            values[android/'latest.json'] = {'schema':'mycellios-android-download/1', 'version':a['version'], 'versionCode':a['versionCode'], 'applicationId':'com.mycellios.android', 'minSdk':26, 'fileName':apk.name, 'path':f"/downloads/android/releases/{a['version']}/{apk.name}", 'sourcePath':f"/downloads/android/releases/{a['version']}/source.tar.gz", 'sha256':digest(apk), 'bytes':apk.stat().st_size, 'signerSha256':SIGNER, 'revision':m['revision'], 'tree':m['tree'], 'automaticUpdates':False, 'sourceSha256':m['source']['sha256']}
        # The shared promotion lock and durable CAS journal preserve other publishers.
        if originals != {n:json.loads((desktop/n).read_text()) for n in names}:
            raise ValueError('Catalog changed during staging')
        promote_pointers(state/'promotion.json', values)
        try:
            for target,c in values.items():
                if json.loads(target.read_text()) != c:
                    raise ValueError('Promoted pointer differs')
            for name, suffix in [('catalog.json',''), ('catalog-macos.json','?include=macos-arm64'), ('catalog-macos-all.json','?include=macos-all')]:
                if json_url('https://www.mycellios.com/public/v1/desktop-downloads'+suffix) != plan[name]:
                    raise ValueError('Public catalog differs after promotion')
            if android/'latest.json' in values and json_url('https://www.mycellios.com/downloads/android/latest.json') != values[android/'latest.json']:
                raise ValueError('Public Android manifest differs after promotion')
        except BaseException:
            rollback_pointers(state/'promotion.json'); raise
        atomic_json(completed, {'published':True, 'revision':m['revision'], 'version':m['version'], 'androidVersion':a['version'], 'originalSignerPreserved':True, 'previousInstallersRetained':True, 'automaticUpdates':False})
        print(json.dumps({'published':True, 'version':m['version'], 'revision':m['revision']})); return
    print('No new qualified installer set')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--config', required=True); args=parser.parse_args()
    once(json.loads(Path(args.config).read_text()))
