import { fileURLToPath } from 'node:url';
import path from 'node:path';

const text = (env, key) => {
  const value = env[key]?.trim();
  if (!value || value.length > 256 || /[\r\n\0]/.test(value)) throw Error(`Missing or invalid ${key}`);
  return value;
};

/** Local previews are explicit in CI; publisher releases never fall back to unsigned. */
export function windowsSigningConfiguration(env = process.env) {
  const mode = env.MYCELLIOS_WINDOWS_SIGNING ?? 'unsigned-preview';
  if (mode === 'unsigned-preview') return { mode, publisher: null, build: { forceCodeSigning: false, win: { signExecutable: false } } };
  if (!['azure', 'certificate-store'].includes(mode)) throw Error('Invalid Windows signing mode');
  const publisher = text(env, 'MYCELLIOS_WINDOWS_PUBLISHER');
  if (mode === 'certificate-store') {
    const thumbprint = text(env, 'MYCELLIOS_WINDOWS_CERTIFICATE_SHA1');
    if (!/^[a-fA-F0-9]{40}$/.test(thumbprint)) throw Error('Invalid signing certificate thumbprint');
    return { mode, publisher, build: { forceCodeSigning: true, win: { signExecutable: true,
      signtoolOptions: { certificateSha1: thumbprint, publisherName: publisher,
        signingHashAlgorithms: ['sha256'], rfc3161TimeStampServer: 'http://timestamp.digicert.com' } } } };
  }
  const endpoint = text(env, 'MYCELLIOS_WINDOWS_AZURE_ENDPOINT');
  if (!/^https:\/\/[a-z0-9]+\.codesigning\.azure\.net\/?$/.test(endpoint)) throw Error('Invalid Azure signing endpoint');
  const account = text(env, 'MYCELLIOS_WINDOWS_AZURE_ACCOUNT');
  const profile = text(env, 'MYCELLIOS_WINDOWS_AZURE_PROFILE');
  if (!/^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$/.test(account) || account.includes('--') || !/^[a-zA-Z0-9._-]{1,100}$/.test(profile)) throw Error('Invalid Azure signing account or profile');
  return { mode, publisher, build: { forceCodeSigning: true, win: { signExecutable: true, azureSignOptions: {
    publisherName: publisher, endpoint, codeSigningAccountName: account, certificateProfileName: profile,
    fileDigest: 'SHA256', timestampRfc3161: 'http://timestamp.acs.microsoft.com', timestampDigest: 'SHA256',
  } } } };
}

export function assertWindowsSignatureReceipt(receipt, installerHash, expectedPublisher) {
  if (receipt?.schema !== 'mycellios-windows-signature/1' || !Array.isArray(receipt.files)) throw Error('Missing Windows signature receipt');
  const installer = receipt.files.find(file => file.role === 'installer');
  if (!installer || installer.sha256 !== installerHash) throw Error('Signature receipt belongs to another installer');
  if (receipt.mode === 'unsigned-preview') {
    if (expectedPublisher || receipt.publisher !== null || receipt.files.some(file => file.status !== 'NotSigned')) throw Error('Invalid unsigned preview receipt');
    return;
  }
  if (receipt.mode !== 'authenticode' || !expectedPublisher || receipt.publisher !== expectedPublisher ||
      !receipt.files.some(file => file.role === 'application') || receipt.files.some(file =>
        file.status !== 'Valid' || !/^[a-fA-F0-9]{40}$/.test(file.thumbprint ?? '') || !file.timestampSubject ||
        (['application', 'installer'].includes(file.role) && file.publisher !== expectedPublisher)))
    throw Error('Untrusted, untimestamped or wrong-publisher Windows release');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { mode, publisher } = windowsSigningConfiguration();
  console.log(JSON.stringify({ mode, publisher, configured: true, signed: false }));
}
