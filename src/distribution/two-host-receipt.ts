import { z } from "zod";
import {
  PHYSICAL_GATE_EVIDENCE_SCHEMA,
  physicalGateEvidenceUnsignedSchema,
  type PhysicalGateEvidenceUnsigned,
} from "../contracts/physical-gate-evidence.js";

/**
 * Builds a `two_host_exact_execution` physical receipt from the files one
 * two-computer run leaves behind (docs/TWO_HOST_QUICKSTART.md, step 5).
 *
 * Every assertion is recomputed from those files: a run record cannot declare
 * itself passing. A failed assertion yields a valid receipt with status "fail".
 */
export const TWO_HOST_RUN_SCHEMA = "mycellios-two-host-run/1" as const;

const sha40 = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nodeId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const timestamp = z.string().datetime({ offset: true });

const linkProbeSchema = z.object({
  schema: z.literal("mycellios-link-probe/1"),
  transport: z.literal("tcp"),
  samples: z.number().int().min(0),
  lost: z.number().int().min(0),
  rttMs: z.object({ min: z.number().finite(), mean: z.number().finite(), p50: z.number().finite(), p95: z.number().finite(), max: z.number().finite() }).strict(),
  bulk: z.object({ bytes: z.number().int().positive(), seconds: z.number().positive(), mbitPerSecond: z.number().positive() }).strict().nullable(),
}).passthrough();

export const twoHostRunRecordSchema = z.object({
  schema: z.literal(TWO_HOST_RUN_SCHEMA),
  startedAt: timestamp,
  completedAt: timestamp,
  sourceSha: sha40,
  networkScope: z.enum(["lan", "multi-site", "public-relay"]),
  hosts: z.array(z.object({
    nodeId,
    commit: sha40,
    sourceId: sha256,
    power: z.enum(["ac", "battery"]),
    probe: z.object({
      schema: z.literal("gdlp-physical-probe/1"),
      host: z.object({ fingerprintSha256: sha256, platform: z.string(), architecture: z.string() }).passthrough(),
      runtime: z.object({ cudaApiAvailable: z.boolean(), directmlApiAvailable: z.boolean().optional() }).passthrough(),
    }).passthrough(),
    leftoverProcesses: z.array(z.string().max(256)).max(64),
  }).strict()).min(2).max(8),
  links: z.array(z.object({ from: nodeId, to: nodeId, probe: linkProbeSchema }).strict()).max(16),
  failure: z.object({ scenario: z.literal("sigkill"), killedNodeId: nodeId, requestFailed: z.boolean() }).strict().optional(),
}).strict();

export type TwoHostRunRecord = z.infer<typeof twoHostRunRecordSchema>;

const launchSchema = z.object({
  totalLayers: z.number().int().positive(),
  runtimeModel: z.object({ artifactIdentity: z.string(), canonicalSource: z.string(), canonicalRevision: z.string() }).passthrough(),
  launchOrder: z.array(z.object({
    stageIndex: z.number().int().min(0),
    layerStart: z.number().int().min(0),
    layerEnd: z.number().int().min(0),
    anchor: z.object({ memberId: z.string() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

const canarySampleSchema = z.object({ outputSha256: z.string(), outputHashScheme: z.string(), completed: z.boolean() }).passthrough();
const statusSchema = z.object({
  state: z.string(),
  boundaries: z.array(z.number().int()).optional(),
  canaryMetrics: z.object({ outputTokenIdsSha256: z.string(), outputTokenHashScheme: z.string() }).passthrough().optional(),
  canaryEvidence: z.array(canarySampleSchema).optional(),
  activationStartupObservation: z.object({ totalMs: z.number().finite() }).passthrough().optional(),
}).passthrough();

const referenceSchema = z.object({
  schema: z.literal("gdlp-greedy-canary-reference/1"),
  outputTokenIdsSha256: sha256,
  outputTokenIdsHashScheme: z.string(),
  model: z.object({ artifactIdentity: z.string(), canonicalRevision: z.string(), device: z.string(), dtype: z.string() }).passthrough(),
}).passthrough();

const benchmarkSchema = z.object({
  rows: z.array(z.object({
    concurrency: z.number().int().positive(),
    measured_requests: z.number().int().min(0),
    nonempty: z.number().int().min(0),
    aggregate_actual_tok_s: z.number().finite(),
    server_token_ttft_mean_ms: z.number().finite(),
    server_token_ttft_p95_ms: z.number().finite(),
    server_token_tpot_mean_ms: z.number().finite(),
    server_token_tpot_p95_ms: z.number().finite(),
  }).passthrough()).min(1),
  server_after_measurement: z.object({
    artifact_identity: z.string(),
    execution: z.object({ stages: z.array(z.object({ stage: z.number().int(), execution: z.object({ backend: z.string(), precision: z.string().optional() }).passthrough() }).passthrough()) }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

export interface TwoHostReceiptInput {
  id: string;
  run: unknown;
  launch: unknown;
  status: unknown;
  reference: unknown;
  benchmark: unknown;
  memorySamplesCsv: string;
  statusAfterFailure?: unknown;
  /** Source identity of the workspace producing the receipt. */
  workspaceSourceId: string;
  artifactDigests: string[];
}

type Assertion = PhysicalGateEvidenceUnsigned["assertions"][number];
type Measurement = PhysicalGateEvidenceUnsigned["measurements"][number];
type Backend = PhysicalGateEvidenceUnsigned["hardware"][number]["backend"];

export function buildTwoHostReceipt(input: TwoHostReceiptInput): PhysicalGateEvidenceUnsigned {
  const run = twoHostRunRecordSchema.parse(input.run);
  const launch = launchSchema.parse(input.launch);
  const status = statusSchema.parse(input.status);
  const reference = referenceSchema.parse(input.reference);
  const benchmark = benchmarkSchema.parse(input.benchmark);
  const hostIds = run.hosts.map((host) => host.nodeId);
  if (new Set(hostIds).size !== hostIds.length) throw new Error("two_host_receipt_duplicate_node_id");
  const stages = [...launch.launchOrder].sort((left, right) => left.stageIndex - right.stageIndex);
  const stageHosts = [...new Set(stages.map((stage) => stage.anchor.memberId))];
  for (const id of stageHosts) if (!hostIds.includes(id)) throw new Error(`two_host_receipt_stage_host_is_unrecorded:${id}`);
  const assertions: Assertion[] = [];
  const check = (id: string, pass: boolean, detail: string, evidence: string[]) => assertions.push({ id, status: pass ? "pass" : "fail", detail, evidence });

  const expected = reference.outputTokenIdsSha256.replace(/^sha256:/, "");
  const samples = status.canaryEvidence ?? [];
  const canaryHashes = [status.canaryMetrics?.outputTokenIdsSha256, ...samples.map((sample) => sample.outputSha256)];
  const schemes = [status.canaryMetrics?.outputTokenHashScheme, ...samples.map((sample) => sample.outputHashScheme)];
  check("exact-output",
    status.state === "running" && samples.length > 0 && samples.every((sample) => sample.completed)
      && canaryHashes.every((hash) => hash === expected) && schemes.every((scheme) => scheme === reference.outputTokenIdsHashScheme),
    `distributed greedy canary token ids (${samples.length} samples) against the complete model on ${reference.model.device}/${reference.model.dtype}`,
    [`reference:${reference.outputTokenIdsSha256}`, ...[...new Set(canaryHashes)].map((hash) => `route:sha256:${hash ?? "missing"}`)]);

  let contiguous = stages.length >= 2 && stages[0]!.layerStart === 0 && stages.at(-1)!.layerEnd === launch.totalLayers;
  for (const [index, stage] of stages.entries()) {
    if (stage.layerStart >= stage.layerEnd) contiguous = false;
    if (index > 0 && stages[index - 1]!.layerEnd !== stage.layerStart) contiguous = false;
  }
  const boundaries = [0, ...stages.map((stage) => stage.layerEnd)];
  if (status.boundaries && status.boundaries.join(",") !== boundaries.join(",")) contiguous = false;
  check("non-empty-ranges", contiguous && stageHosts.length >= 2,
    `${stages.length} contiguous non-empty layer ranges over ${stageHosts.length} hosts`,
    stages.map((stage) => `stage-${stage.stageIndex}:${stage.anchor.memberId}:${stage.layerStart}-${stage.layerEnd}`));

  const stageRecords = run.hosts.filter((host) => stageHosts.includes(host.nodeId));
  const fingerprints = new Set(stageRecords.map((host) => host.probe.host.fingerprintSha256));
  check("distinct-machines", fingerprints.size === stageRecords.length && stageRecords.length >= 2,
    "every stage host has its own physical machine fingerprint", stageRecords.map((host) => `${host.nodeId}:${host.probe.host.fingerprintSha256}`));

  const model = launch.runtimeModel;
  const buildMatches = run.hosts.every((host) => host.commit === run.sourceSha && host.sourceId === input.workspaceSourceId);
  const modelMatches = model.artifactIdentity === reference.model.artifactIdentity
    && model.canonicalRevision === reference.model.canonicalRevision
    && benchmark.server_after_measurement.artifact_identity === model.artifactIdentity;
  check("build-model-match", buildMatches && modelMatches,
    "every host ran the receipt's commit and source identity; route, reference and server served one model artifact",
    [...run.hosts.map((host) => `${host.nodeId}:${host.commit}:${host.sourceId}`), `workspace:${input.workspaceSourceId}`,
      `model:${model.artifactIdentity}`, `reference-model:${reference.model.artifactIdentity}`]);

  check("api-benchmark-complete", benchmark.rows.every((row) => row.measured_requests > 0 && row.nonempty === row.measured_requests),
    "every measured API request returned content", benchmark.rows.map((row) => `c${row.concurrency}:${row.nonempty}/${row.measured_requests}`));

  const linkEvidence: string[] = [];
  let linksComplete = true;
  for (const from of stageHosts) for (const to of stageHosts) {
    if (from === to) continue;
    const link = run.links.find((entry) => entry.from === from && entry.to === to);
    if (!link || link.probe.samples === 0 || link.probe.lost > 0) linksComplete = false;
    linkEvidence.push(link ? `${from}->${to}:tcp:${link.probe.samples}/${link.probe.samples + link.probe.lost}` : `${from}->${to}:missing`);
  }
  check("link-measured-both-directions", linksComplete, "TCP round trips measured in each direction between stage hosts without loss", linkEvidence);

  check("mains-power", run.hosts.every((host) => host.power === "ac"), "every host ran on mains power",
    run.hosts.map((host) => `${host.nodeId}:${host.power}`));

  check("cleanup-complete", run.hosts.every((host) => host.leftoverProcesses.length === 0),
    "no runtime, stage or launch-agent process remained on any host",
    run.hosts.map((host) => `${host.nodeId}:${host.leftoverProcesses.length === 0 ? "none" : host.leftoverProcesses.join(";")}`));

  const scenarios = ["local-complete", "split", "api-benchmark"];
  if (run.failure) {
    scenarios.push(run.failure.scenario);
    const after = input.statusAfterFailure === undefined ? undefined : statusSchema.parse(input.statusAfterFailure);
    check("failure-fails-closed", stageHosts.includes(run.failure.killedNodeId) && run.failure.requestFailed && after !== undefined && after.state !== "running",
      "killing a stage host mid-request failed the request and closed the route",
      [`killed:${run.failure.killedNodeId}`, `request:${run.failure.requestFailed ? "failed" : "completed"}`, `route-after:${after?.state ?? "missing"}`]);
  }

  const measurements: Measurement[] = [];
  const add = (name: string, value: number, unit: string, aggregation: Measurement["aggregation"]) =>
    measurements.push({ name, value, unit, aggregation, evidenceClass: "hardware-physical" });
  for (const row of benchmark.rows) {
    const suffix = row.concurrency === 1 ? "" : `.c${row.concurrency}`;
    add(`ttft-ms${suffix}`, row.server_token_ttft_mean_ms, "ms", "mean");
    add(`ttft-ms${suffix}`, row.server_token_ttft_p95_ms, "ms", "p95");
    add(`tpot-ms${suffix}`, row.server_token_tpot_mean_ms, "ms", "mean");
    add(`tpot-ms${suffix}`, row.server_token_tpot_p95_ms, "ms", "p95");
    add(`tokens-per-second${suffix}`, row.aggregate_actual_tok_s, "tokens/s", "mean");
  }
  const peaks = peakMemoryMib(input.memorySamplesCsv, hostIds);
  add("peak-memory-mib", Math.max(...Object.values(peaks)), "MiB", "max");
  for (const [id, value] of Object.entries(peaks)) add(`peak-memory-mib.${id}`, value, "MiB", "max");
  for (const link of run.links) {
    const name = `link-rtt-ms.${link.from}-to-${link.to}`;
    add(name, link.probe.rttMs.min, "ms", "min");
    add(name, link.probe.rttMs.mean, "ms", "mean");
    add(name, link.probe.rttMs.p95, "ms", "p95");
    add(name, link.probe.rttMs.max, "ms", "max");
    if (link.probe.bulk) add(`link-throughput-mbps.${link.from}-to-${link.to}`, link.probe.bulk.mbitPerSecond, "Mbit/s", "sample");
  }
  if (status.activationStartupObservation) add("activation-to-canary-ms", status.activationStartupObservation.totalMs, "ms", "sample");

  const observed = new Map((benchmark.server_after_measurement.execution?.stages ?? []).map((entry) => [entry.stage, entry.execution]));
  const hardware = run.hosts.map((host) => {
    const stage = stages.find((entry) => entry.anchor.memberId === host.nodeId);
    return { id: host.nodeId, fingerprint: host.probe.host.fingerprintSha256, platform: platformOf(host.probe.host),
      backend: backendOf(host, stage ? observed.get(stage.stageIndex)?.backend : undefined), driverVersion: null };
  });

  return physicalGateEvidenceUnsignedSchema.parse({
    schema: PHYSICAL_GATE_EVIDENCE_SCHEMA, id: input.id,
    gate: "G3_AUTOMATIC_EXECUTION", check: "two_host_exact_execution", campaign: "two-host-execution",
    status: assertions.some((assertion) => assertion.status === "fail") ? "fail" : "pass",
    sourceSha: run.sourceSha, sourceId: input.workspaceSourceId,
    artifactDigests: [...new Set(input.artifactDigests)].sort(),
    startedAt: run.startedAt, completedAt: run.completedAt, hardware,
    coverage: { platforms: dedupe(hardware.map((entry) => entry.platform)), networkScopes: [run.networkScope], scenarios,
      models: [`${model.canonicalSource}@${model.canonicalRevision}`] },
    measurements, assertions,
  });
}

/** Columns: an ISO timestamp, then resident bytes per node id named in the header. */
export function peakMemoryMib(csv: string, nodeIds: readonly string[]): Record<string, number> {
  const [header, ...rows] = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const columns = header?.split(",").map((column) => column.trim()) ?? [];
  if (columns[0] !== "timestamp") throw new Error("two_host_receipt_memory_header_is_invalid");
  const peaks: Record<string, number> = {};
  for (const id of nodeIds) {
    const index = columns.indexOf(id);
    if (index < 1) throw new Error(`two_host_receipt_memory_column_is_missing:${id}`);
    let peak = 0;
    for (const row of rows) {
      const value = Number(row.split(",")[index]);
      if (Number.isFinite(value) && value > peak) peak = value;
    }
    if (peak <= 0) throw new Error(`two_host_receipt_memory_is_unobserved:${id}`);
    peaks[id] = Math.round((peak / (1024 * 1024)) * 10) / 10;
  }
  return peaks;
}

function platformOf(host: { platform: string; architecture: string }): PhysicalGateEvidenceUnsigned["hardware"][number]["platform"] {
  const os = ({ windows: "win32", win32: "win32", darwin: "darwin", linux: "linux" } as const)[host.platform.toLowerCase() as "windows"];
  const arch = ({ amd64: "x64", x86_64: "x64", x64: "x64", arm64: "arm64", aarch64: "arm64" } as const)[host.architecture.toLowerCase() as "amd64"];
  if (!os || !arch) throw new Error(`two_host_receipt_platform_is_unsupported:${host.platform}:${host.architecture}`);
  return { os, arch };
}

function backendOf(host: TwoHostRunRecord["hosts"][number], observed: string | undefined): Backend {
  const backends: readonly Backend[] = ["cpu", "cuda", "rocm", "mps", "directml"];
  if (observed !== undefined) {
    if (!backends.includes(observed as Backend)) throw new Error(`two_host_receipt_backend_is_unsupported:${host.nodeId}:${observed}`);
    return observed as Backend;
  }
  // A stage the root does not observe used the device its host probe offered.
  const accelerated = host.probe.runtime.cudaApiAvailable || host.probe.runtime.directmlApiAvailable === true
    || host.probe.host.platform.toLowerCase() === "darwin";
  if (accelerated) throw new Error(`two_host_receipt_backend_is_unobserved:${host.nodeId}`);
  return "cpu";
}

function dedupe<T>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => { const key = JSON.stringify(value); if (seen.has(key)) return false; seen.add(key); return true; });
}
