import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ABI = 'mycellios-distribution-runtime/4';
export function contributionCommand(nodeId, generation, type, now = Date.now()) {
  if (!['pause', 'resume'].includes(type)) throw Error('unsupported_ci_command');
  return { schema: 'mycellios-node-command/1', id: randomUUID(), nodeId,
    actor: { kind: 'account', id: 'ci-macos95', scopes: ['node:control'] }, generation,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 120_000).toISOString(),
    nonce: randomUUID().replaceAll('-', ''), type, payload: { version: 1 } };
}

export async function verifyCiContracts(payload) {
  const source = async (path) => await import(pathToFileURL(join(resolve(payload), 'dist', path)));
  const { MYCELLIOS_RUNTIME_ABI } = await source('update/runtime-compatibility.js');
  assert.equal(MYCELLIOS_RUNTIME_ABI, ABI);
  const contracts = await source('contracts/node-control.js');
  for (const type of ['pause', 'resume']) {
    const command = contributionCommand('node-' + '1'.repeat(32), 1, type);
    assert.deepEqual(contracts.nodeCommandSchema.parse(command), command);
    assert.throws(() => contracts.nodeCommandSchema.parse({ ...command, generation: 0 }));
  }
  contracts.nodeEnrollmentBundleSchema.parse({ schema: 'mycellios-node-enrollment-bundle/1',
    coordinatorUrl: 'http://127.0.0.1:18791/', enrollmentId: randomUUID(),
    enrollmentToken: 't'.repeat(43), nonce: 'n'.repeat(32), expiresAt: new Date(Date.now() + 120_000).toISOString() });
  return { abi: ABI, pauseResumeSchemas: true, invalidGenerationRejected: true, localEnrollmentSchema: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(JSON.stringify(await verifyCiContracts(process.argv[2])));
}
