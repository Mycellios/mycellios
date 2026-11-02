import { createPublicKey, type KeyLike } from "node:crypto";
import { executionReceiptSchema, signExecutionReceipt, type ExecutionReceipt, type ExecutionReceiptBody } from "../contracts/execution-receipt.js";
import type { MeshDatabase } from "../storage/database.js";
import { executionTopologySchema, redactExecutionTopology, type ExecutionTopology } from "../contracts/execution-topology.js";
import type { NetworkExecutionTrace } from "../contracts/types.js";

export class ExecutionReceiptStore {
  constructor(private readonly database: MeshDatabase, private readonly signing: { keyId: string; privateKey: KeyLike }) {}

  verificationKey(): { keyId: string; spki: string } {
    const publicKey = createPublicKey(this.signing.privateKey);
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("execution_receipt_public_key_is_not_ed25519");
    return { keyId: this.signing.keyId, spki: publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
  }

  async record(body: ExecutionReceiptBody, topology?: { trace: NetworkExecutionTrace; regionForWorker: (workerId: string) => string | null | Promise<string | null> }): Promise<ExecutionReceipt> {
    const receipt = signExecutionReceipt(body, this.signing);
    return (await this.database.transaction(async () => {
      const existing = (await this.forJob(body.jobId));
      if (existing) {
        if (existing.receiptId !== receipt.receiptId) throw new Error("execution_receipt_job_conflict");
        if (topology) (await this.recordTopology(receipt, topology));
        return existing;
      }
      (await this.database.raw.prepare(`INSERT INTO execution_receipts(job_id, receipt_id, key_id, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(body.jobId, receipt.receiptId, receipt.keyId, JSON.stringify(receipt), body.completedAt));
      if (topology) (await this.recordTopology(receipt, topology));
      return receipt;
    }));
  }

  async forJob(jobId: string): Promise<ExecutionReceipt | null> {
    const row = (await this.database.raw.prepare("SELECT receipt_json FROM execution_receipts WHERE job_id = ?").get(jobId)) as { receipt_json: string } | undefined;
    return row ? executionReceiptSchema.parse(JSON.parse(row.receipt_json)) : null;
  }

  async topologyForJob(jobId: string): Promise<ExecutionTopology | null> {
    const row = (await this.database.raw.prepare("SELECT topology_json FROM execution_topologies WHERE job_id = ?").get(jobId)) as { topology_json: string } | undefined;
    return row ? executionTopologySchema.parse(JSON.parse(row.topology_json)) : null;
  }

  async listRecent(limit = 20): Promise<ExecutionReceipt[]> {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = (await this.database.raw.prepare("SELECT receipt_json FROM execution_receipts ORDER BY created_at DESC, job_id DESC LIMIT ?")
      .all(bounded)) as Array<{ receipt_json: string }>;
    return rows.map((row) => executionReceiptSchema.parse(JSON.parse(row.receipt_json)));
  }

  private async recordTopology(receipt: ExecutionReceipt, input: { trace: NetworkExecutionTrace; regionForWorker: (workerId: string) => string | null | Promise<string | null> }): Promise<void> {
    const regions = new Map<string, string | null>();
    for (const stage of input.trace.stages) {
      const id = stage.workerId ?? stage.deploymentOwnerWorkerId;
      if (!regions.has(id)) regions.set(id, await input.regionForWorker(id));
    }
    const topology = redactExecutionTopology({ receipt, trace: input.trace, regionForWorker: id => regions.get(id) ?? null });
    const existing = (await this.topologyForJob(receipt.jobId));
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(topology)) throw new Error("execution_topology_job_conflict");
      return;
    }
    (await this.database.raw.prepare(`INSERT INTO execution_topologies(job_id, receipt_id, trace_digest, topology_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(receipt.jobId, receipt.receiptId, receipt.networkTraceDigest, JSON.stringify(topology), receipt.completedAt));
  }
}
