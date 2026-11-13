import copy, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import publisher as p

def manifest():
    version='0.3.48'; revision='a'*40
    def item(name): return {'fileName':name,'bytes':100,'sha256':'b'*64}
    return {'schema':'mycellios-installer-release/1','version':version,'revision':revision,'tree':'c'*40,'workflowRun':1,'automaticUpdates':False,
            'platforms':[dict(item('Mycellios-Desktop-'+version+'-'+suffix),id=identity,format=fmt,version=version) for identity,(fmt,suffix) in p.IDS.items()],
            'source':item('Mycellios-Desktop-'+version+'-source-'+revision[:8]+'.tar.gz'),
            'android':{'version':'1.3.48','versionCode':103048,'applicationId':'com.mycellios.android','minSdk':26,'signerSha256':p.SIGNER,'input':item('android-build-input.apk'),'buildReceipt':item('android-build.json')}}

def catalogs():
    windows={'id':'windows-x64','version':'0.3.47','operatorMetadata':'retained'}
    linux={'id':'linux-x64','version':'0.3.44'}
    base={'schema':'mycellios-desktop-downloads/1','version':'0.3.47','automaticUpdates':False,'runtimeVersion':'0.2.95','source':{},'packages':[windows,linux]}
    mac=copy.deepcopy(base); mac['packages'].append({'id':'macos-arm64','version':'0.3.9'})
    allmac=copy.deepcopy(mac); allmac['packages'].append({'id':'macos-x64','version':'0.3.9'})
    allmac['fedora']={'id':'fedora-x64','version':'0.3.44'}
    return dict(zip(['catalog.json','catalog-macos.json','catalog-macos-all.json'],[base,mac,allmac]))

class PublisherTests(unittest.TestCase):
    def test_common_source_and_signing_identity_are_required(self):
        self.assertIs(p.validate_manifest(manifest())['automaticUpdates'],False)
        for key,value in [('revision','unknown'),('tree','unknown'),('automaticUpdates',True)]:
            m=manifest();m[key]=value
            with self.assertRaises(ValueError):p.validate_manifest(m)
        for key,value in [('versionCode',3),('signerSha256','f'*64),('applicationId','other.app')]:
            m=manifest();m['android'][key]=value
            with self.assertRaises(ValueError):p.validate_manifest(m)
        m=manifest();m['platforms'].pop()
        with self.assertRaises(ValueError):p.validate_manifest(m)

    def test_catalog_compatibility_and_metadata_are_preserved(self):
        before=catalogs();saved=copy.deepcopy(before);plan=p.catalog_plan(manifest(),before)
        self.assertEqual(before,saved)
        self.assertEqual([len(plan[n]['packages']) for n in plan],[2,3,4])
        self.assertNotIn('fedora',plan['catalog.json'])
        self.assertEqual(plan['catalog-macos-all.json']['fedora']['version'],'0.3.48')
        self.assertEqual(plan['catalog.json']['packages'][0]['operatorMetadata'],'retained')
        self.assertTrue(plan['catalog.json']['packages'][0]['path'].endswith('?sha256='+'b'*64))
        before['catalog.json']['packages'][1]['version']='0.3.49'
        with self.assertRaises(ValueError):p.catalog_plan(manifest(),before)

    def test_installer_traversal_and_receipt_substitution_are_rejected(self):
        for key,value in [('fileName','../../private'),('sha256','unknown'),('bytes',0),('bytes',2_000_000_001),('bytes',True)]:
            m=manifest();m['platforms'][0][key]=value
            with self.assertRaises(ValueError):p.validate_manifest(m)

    def test_interrupted_pointer_promotion_recovers_without_erasing_external_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);a=root/'a.json';b=root/'b.json';journal=root/'journal.json'
            a.write_text('{"version":1}');b.write_text('{"version":1}')
            original=p.atomic_json
            def interrupt(target,value):
                if Path(target)==b:raise RuntimeError('synthetic interruption')
                original(target,value)
            with patch.object(p,'atomic_json',side_effect=interrupt):
                with self.assertRaises(RuntimeError):p.promote_pointers(journal,{a:{'version':2},b:{'version':2}})
            self.assertEqual(json.loads(a.read_text())['version'],2)
            p.recover_journal(journal,{str(a),str(b)})
            self.assertEqual(json.loads(b.read_text())['version'],2)
            p.rollback_pointers(journal)
            self.assertEqual(json.loads(a.read_text())['version'],1)
            with patch.object(p,'atomic_json',side_effect=interrupt):
                with self.assertRaises(RuntimeError):p.promote_pointers(journal,{a:{'version':2},b:{'version':2}})
            b.write_text('{"version":3,"external":true}')
            with self.assertRaises(ValueError):p.recover_journal(journal,{str(a),str(b)})
            self.assertTrue(json.loads(b.read_text())['external'])

    def test_signer_mismatch_blocks_apk_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);jar=root/'apksigner.jar';jar.write_bytes(b'synthetic tool')
            keys=root/'keys';keys.mkdir()
            for n in ['release.p12','password']:(keys/n).write_text('synthetic');(keys/n).chmod(0o600)
            stage=root/'stage';stage.mkdir();(stage/'signed').mkdir();(stage/'signed/Mycellios-Android-1.3.48.apk').write_bytes(b'synthetic apk')
            config={'signerJar':str(jar),'signerJarSha256':p.digest(jar),'signingKeys':str(keys),'signerImage':'fixture@sha256:'+'a'*64}
            text='Signer #1 certificate SHA-256 digest: '+'f'*64+'\nVerified using v2 scheme (APK Signature Scheme v2): true\nVerified using v3 scheme (APK Signature Scheme v3): true'
            with patch.object(p.subprocess,'check_output',return_value=text):
                with self.assertRaises(ValueError):p.sign_android(config,stage,manifest()['android'])

    def test_actual_apk_web_must_match_the_current_source_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk=Path(tmp)/'fixture.apk';m=manifest();data=b'qualified application'
            receipt={'revision':m['revision'],'tree':m['tree'],'version':m['android']['version'],'versionCode':m['android']['versionCode'],'applicationId':'com.mycellios.android','sharedWebFiles':{'index.html':p.hashlib.sha256(data).hexdigest()}}
            def write(body, extra=False):
                with p.zipfile.ZipFile(apk,'w') as z:
                    z.writestr('assets/web/index.html',body);z.writestr('assets/web-files.json','["index.html"]')
                    if extra:z.writestr('assets/web/stale.js','stale source')
            write(data);p.verify_android_web(apk,receipt,m)
            write(b'previous release')
            with self.assertRaises(ValueError):p.verify_android_web(apk,receipt,m)
            write(data,True)
            with self.assertRaises(ValueError):p.verify_android_web(apk,receipt,m)

if __name__=='__main__':unittest.main()
