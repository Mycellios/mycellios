import {spawnSync} from 'node:child_process';

/** Integrity and Apple distribution trust are independent qualification results. */
export function checkPreviewSignature(app,run=spawnSync) {
  const options={encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']};
  const verified=run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app],options);
  if(verified.error||verified.status!==0)throw Error('Packaged application signature is missing or invalid');
  const detail=run('/usr/bin/codesign',['--display','--verbose=4',app],options);
  if(detail.error||detail.status!==0||!/^Signature=adhoc\s*$/m.test((detail.stdout??'')+'\n'+(detail.stderr??'')))throw Error('Preview must have the expected ad-hoc signature');
  const assessment=run('/usr/sbin/spctl',['--assess','--type','execute','--verbose=4',app],options);
  if(assessment.error||assessment.status===null)throw Error('Gatekeeper assessment could not run');
  if(assessment.status!==0&&!/\brejected\b/i.test((assessment.stdout??'')+'\n'+(assessment.stderr??'')))throw Error('Gatekeeper assessment did not provide a trust decision');
  // A runner's local policy/cache cannot grant Developer ID trust to a preview.
  return {integrityVerified:true,signature:'ad-hoc',notarized:false,gatekeeperAccepted:assessment.status===0,gatekeeperStatus:assessment.status,requiresManualApproval:true};
}
