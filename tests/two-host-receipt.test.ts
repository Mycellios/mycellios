import { createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sealPhysicalGateEvidence } from "../src/contracts/physical-gate-evidence.js";
import { buildTwoHostReceipt, peakMemoryMib, type TwoHostReceiptInput } from "../src/distribution/two-host-receipt.js";
import { importPhysicalGateEvidence } from "../src/program/physical-gate-evidence.js";

const sourceSha = "a".repeat(40);
const sourceId = `sha256:${"c".repeat(64)}`;
const artifact = `sha256:${"7".repeat(64)}`;
const outputHash = "d".repeat(64);

describe("two-host receipt builder", () => {
  it("passes a complete run and imports once signed by a trusted key", () => {
    const receipt = buildTwoHostReceipt(input());
    expect(receipt.status).toBe("pass");
    expect(Object.fromEntries(receipt.assertions.map((entry) => [entry.id, entry.status]))).toEqual({
      "exact-output": "pass", "non-empty-ranges": "pass", "distinct-machines": "pass", "build-model-match": "pass",
      "api-benchmark-complete": "pass", "link-measured-both-directions": "pass", "mains-power": "pass", "cleanup-complete": "pass",
      "failure-fails-closed": "pass",
    });
    expect(receipt.hardware).toEqual([
      expect.objectContaining({ id: "host-a", platform: { os: "win32", arch: "x64" }, backend: "cpu" }),
      expect.objectContaining({ id: "host-b", platform: { os: "darwin", arch: "arm64" }, backend: "mps" }),
    ]);
    expect(receipt.coverage.scenarios).toEqual(["local-complete", "split", "api-benchmark", "sigkill"]);
    const values = Object.fromEntries(receipt.measurements.map((entry) => [`${entry.name}:${entry.aggregation}`, entry.value]));
    expect(values).toMatchObject({ "ttft-ms:mean": 565, "tpot-ms:p95": 214, "tokens-per-second:mean": 4.9, "peak-memory-mib:max": 2048,
      "peak-memory-mib.host-b:max": 1024, "link-rtt-ms.host-b-to-host-a:mean": 9, "link-throughput-mbps.host-a-to-host-b:sample": 300 });

    const { privateKey } = generateKeyPairSync("ed25519");
    const publicKeySpki = Buffer.from(createPublicKey(privateKey).export({ format: "der", type: "spki" })).toString("base64url");
    const sealed = sealPhysicalGateEvidence(receipt, "physical-lab-1", privateKey);
    const imported = importPhysicalGateEvidence({ receipts: [sealed], sourceSha, sourceIdentity: sourceId,
      trust: { schema: "mycellios-physical-evidence-trust/1", keys: [{ keyId: "physical-lab-1", publicKeySpki, status: "active" }] },
      existing: { schema: "mycellios-gate-imported-evidence/1", evidence: [] } });
    expect(imported.evidence[0]).toMatchObject({ check: "two_host_exact_execution", status: "pass" });
  });

  it.each([
    ["mains-power", (value: Fixture) => { value.run.hosts[1]!.power = "battery"; }],
    ["exact-output", (value: Fixture) => { value.status.canaryEvidence[1]!.outputSha256 = "e".repeat(64); }],
    ["link-measured-both-directions", (value: Fixture) => { value.run.links = value.run.links.filter((link) => link.from !== "host-b"); }],
    ["build-model-match", (value: Fixture) => { value.run.hosts[1]!.commit = "b".repeat(40); }],
    ["build-model-match", (value: Fixture) => { value.reference.model.artifactIdentity = `sha256:${"8".repeat(64)}`; }],
    ["cleanup-complete", (value: Fixture) => { value.run.hosts[0]!.leftoverProcesses = ["4242 python.exe"]; }],
    ["non-empty-ranges", (value: Fixture) => { value.launch.launchOrder[1]!.layerStart = 13; }],
    ["failure-fails-closed", (value: Fixture) => { value.statusAfterFailure.state = "running"; }],
  ])("fails %s when the evidence does not support it", (id, mutate) => {
    const value = fixture(); mutate(value);
    const receipt = buildTwoHostReceipt({ ...input(), ...value });
    expect(receipt.status).toBe("fail");
    expect(receipt.assertions.find((entry) => entry.id === id)?.status).toBe("fail");
  });

  it("refuses to guess the device of an accelerated host whose stage was not observed", () => {
    const value = fixture();
    value.benchmark.server_after_measurement.execution.stages = [];
    expect(() => buildTwoHostReceipt({ ...input(), ...value })).toThrow("two_host_receipt_backend_is_unobserved:host-b");
  });

  it("reads peak memory per named column", () => {
    expect(peakMemoryMib("timestamp,host-a,host-b\nt,1048576,\nt,3145728,2097152\n", ["host-a", "host-b"])).toEqual({ "host-a": 3, "host-b": 2 });
    expect(() => peakMemoryMib("t,1,2\n", ["host-a"])).toThrow("two_host_receipt_memory_header_is_invalid");
    expect(() => peakMemoryMib("timestamp,host-a,host-b\nt,1,0\n", ["host-a", "host-b"])).toThrow("two_host_receipt_memory_is_unobserved:host-b");
  });
});

type Fixture = ReturnType<typeof fixture>;

function input(): TwoHostReceiptInput {
  return { id: randomUUID(), ...fixture(), memorySamplesCsv: "timestamp,host-a,host-b\nt,2147483648,1073741824\n",
    workspaceSourceId: sourceId, artifactDigests: [`sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`] };
}

function fixture() {
  const host = (nodeId: string, platform: string, architecture: string, fingerprint: string) => ({
    nodeId, commit: sourceSha, sourceId, power: "ac" as "ac" | "battery", leftoverProcesses: [] as string[],
    probe: { schema: "gdlp-physical-probe/1", host: { fingerprintSha256: `sha256:${fingerprint.repeat(64)}`, platform, architecture },
      runtime: { cudaApiAvailable: false } },
  });
  const link = (from: string, to: string, mean: number) => ({ from, to, probe: { schema: "mycellios-link-probe/1", transport: "tcp", samples: 200, lost: 0,
    rttMs: { min: mean - 3, mean, p50: mean, p95: mean + 4, max: mean + 20 }, bulk: { bytes: 16777216, seconds: 0.45, mbitPerSecond: 300 } } });
  const sample = () => ({ outputSha256: outputHash, outputHashScheme: "gdlp-output-token-ids-v1", completed: true });
  return {
    run: { schema: "mycellios-two-host-run/1", startedAt: "2026-11-25T20:00:00.000Z", completedAt: "2026-11-25T20:05:00.000Z", sourceSha,
      networkScope: "lan", hosts: [host("host-a", "windows", "AMD64", "a"), host("host-b", "darwin", "arm64", "b")],
      links: [link("host-a", "host-b", 8), link("host-b", "host-a", 9)], failure: { scenario: "sigkill", killedNodeId: "host-b", requestFailed: true } },
    launch: { totalLayers: 28, runtimeModel: { artifactIdentity: artifact, canonicalSource: "hf://Qwen/Qwen3-0.6B", canonicalRevision: "c1899de2" },
      launchOrder: [
        { stageIndex: 1, layerStart: 14, layerEnd: 28, anchor: { memberId: "host-a" } },
        { stageIndex: 0, layerStart: 0, layerEnd: 14, anchor: { memberId: "host-b" } },
      ] },
    status: { state: "running", boundaries: [0, 14, 28], canaryMetrics: { outputTokenIdsSha256: outputHash, outputTokenHashScheme: "gdlp-output-token-ids-v1" },
      canaryEvidence: [sample(), sample(), sample()], activationStartupObservation: { totalMs: 35000 } },
    reference: { schema: "gdlp-greedy-canary-reference/1", outputTokenIdsSha256: `sha256:${outputHash}`, outputTokenIdsHashScheme: "gdlp-output-token-ids-v1",
      model: { artifactIdentity: artifact, canonicalRevision: "c1899de2", device: "cpu", dtype: "float32" } },
    benchmark: { rows: [{ concurrency: 1, measured_requests: 5, nonempty: 5, aggregate_actual_tok_s: 4.9, server_token_ttft_mean_ms: 565,
      server_token_ttft_p95_ms: 719, server_token_tpot_mean_ms: 193, server_token_tpot_p95_ms: 214 }],
    server_after_measurement: { artifact_identity: artifact, execution: { stages: [{ stage: 0, execution: { backend: "mps", precision: "float16" } }] as unknown[] } } },
    statusAfterFailure: { state: "failed" },
  };
}
