import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sealPhysicalGateEvidence, verifyPhysicalGateEvidence } from "../src/contracts/physical-gate-evidence.js";
import { buildTwoHostReceipt } from "../src/distribution/two-host-receipt.js";
import { physicalEvidenceTrustSchema } from "../src/program/physical-gate-evidence.js";
import { buildNativeSourceProvenance } from "./native-build-provenance.mjs";

/**
 * npm run evidence:two-host -- keygen --out <private key file> [--key-id physical-lab-1]
 * npm run evidence:two-host -- build --evidence <run directory> [--key <file> --key-id <id>]
 * npm run evidence:two-host -- verify --receipt <file> [--trust config/physical-evidence-trust.json]
 *
 * The private key never enters the repository or the output; only its public
 * SPKI is printed, for an operator to add to the trust file.
 */
const RUN_FILES = {
  run: "run.json", launch: "python-launch.json", status: "status.json", reference: "canary-reference.json",
  benchmark: "api-benchmark.json", memory: "memory-samples.csv", statusAfterFailure: "status-after-failure.json",
} as const;

export function runTwoHostReceiptCli(argv: readonly string[], workspace = process.cwd()): number {
  const [command, ...rest] = argv;
  const option = (name: string) => { const at = rest.indexOf(`--${name}`); const value = at >= 0 ? rest[at + 1] : undefined; return value && !value.startsWith("--") ? value : undefined; };
  const required = (name: string) => { const value = option(name); if (!value) throw new Error(`two_host_receipt_option_is_required:--${name}`); return value; };
  if (command === "keygen") {
    const out = resolve(required("out"));
    if (existsSync(out)) throw new Error("two_host_receipt_key_file_exists");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(out, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600, flag: "wx" });
    print({ keyId: option("key-id") ?? "physical-lab-1", publicKeySpki: spki(publicKey), privateKeyFile: out });
    return 0;
  }
  if (command === "build") {
    const directory = resolve(required("evidence"));
    const read = (file: string) => readFileSync(join(directory, file));
    const json = (file: string) => JSON.parse(read(file).toString("utf8")) as unknown;
    const present = (Object.values(RUN_FILES) as string[]).filter((file) => existsSync(join(directory, file)));
    const unsigned = buildTwoHostReceipt({
      id: randomUUID(), run: json(RUN_FILES.run), launch: json(RUN_FILES.launch), status: json(RUN_FILES.status),
      reference: json(RUN_FILES.reference), benchmark: json(RUN_FILES.benchmark), memorySamplesCsv: read(RUN_FILES.memory).toString("utf8"),
      ...(present.includes(RUN_FILES.statusAfterFailure) ? { statusAfterFailure: json(RUN_FILES.statusAfterFailure) } : {}),
      workspaceSourceId: buildNativeSourceProvenance(workspace).sourceId,
      artifactDigests: present.map((file) => `sha256:${createHash("sha256").update(read(file)).digest("hex")}`),
    });
    const keyFile = option("key");
    const receipt = keyFile ? sealPhysicalGateEvidence(unsigned, required("key-id"), createPrivateKey(readFileSync(resolve(keyFile)))) : unsigned;
    const out = join(directory, keyFile ? "two-host-receipt.json" : "two-host-receipt.unsigned.json");
    writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    summarize(receipt, out);
    return receipt.status === "pass" ? 0 : 1;
  }
  if (command === "verify") {
    const trust = physicalEvidenceTrustSchema.parse(JSON.parse(readFileSync(resolve(option("trust") ?? join(workspace, "config/physical-evidence-trust.json")), "utf8")));
    const keys = new Map(trust.keys.filter((key) => key.status === "active").map((key) => [key.keyId, key.publicKeySpki]));
    const receipt = verifyPhysicalGateEvidence(JSON.parse(readFileSync(resolve(required("receipt")), "utf8")), keys);
    summarize(receipt, resolve(required("receipt")));
    return receipt.status === "pass" ? 0 : 1;
  }
  throw new Error("two_host_receipt_command_is_unknown: use keygen, build or verify");
}

function spki(key: ReturnType<typeof createPublicKey>): string {
  return Buffer.from(key.export({ format: "der", type: "spki" })).toString("base64url");
}

function summarize(receipt: { status: string; assertions: { id: string; status: string }[]; receiptDigest?: string }, file: string): void {
  print({ file, status: receipt.status, receiptDigest: receipt.receiptDigest ?? null,
    assertions: Object.fromEntries(receipt.assertions.map((assertion) => [assertion.id, assertion.status])) });
}

function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try { process.exitCode = runTwoHostReceiptCli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`two-host-receipt: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; }
}
