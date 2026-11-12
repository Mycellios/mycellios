import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { browserTextModel, browserTextReplySchema, type BrowserTextRequest } from "../contracts/browser-text.js";
import { BrowserTextReference } from "./browser-text-reference.js";
import { Gpt2Tokenizer } from "../core/gpt2-tokenizer.js";
import { sha256CanonicalEvidence } from "../core/json.js";
import { browserOnnxAssets } from "./browser-onnx-assets.js";

type Peer = { id: string; token: string; fingerprint: string | null; available: boolean };
type Pending = { taskId: string; leaseId: string; resolve(ids: number[]): void; reject(error: Error): void; timer: NodeJS.Timeout };
/** Bounded complete-model pilot. A worker-supplied sentence is never sufficient to earn credits. */
export class BrowserTextHub {
  private directory: string | null = null;
  private readonly assets = new Map<string, Buffer>();
  private tokenizer: Gpt2Tokenizer | null = null;
  private reference: BrowserTextReference | null = null;
  private readonly pending = new Map<string, Pending>();
  private referenceBusy = false;
  constructor(private readonly transport: {
    peers(): Peer[]; acquire(id: string): boolean; release(id: string): void;
    send(id: string, type: string, payload: unknown): void; verified(id: string): void;
  }) {}
  async enable(app: FastifyInstance, directory: string) {
    if (this.directory) throw new Error("browser_text_already_enabled");
    const root = resolve(directory, browserTextModel.files["model.onnx"].sha256);
    for (const [name, pinned] of Object.entries(browserTextModel.files)) {
      const bytes = await readFile(resolve(root, name));
      if (bytes.length !== pinned.bytes || createHash("sha256").update(bytes).digest("hex") !== pinned.sha256)
        throw new Error("browser_text_asset_revision_invalid");
      this.assets.set(name, bytes);
    }
    this.tokenizer = new Gpt2Tokenizer(this.assets.get("vocab.json")!.toString(), this.assets.get("merges.txt")!.toString());
    this.directory = root;
    browserOnnxAssets(app);
    app.get("/mobile/v1/text/:artifactId/:file", async (request, reply) => {
      const { artifactId, file } = request.params as { artifactId: string; file: string };
      const bearer = request.headers.authorization?.replace(/^Bearer /, "");
      if (!bearer || !this.transport.peers().some(p => p.token === bearer && p.fingerprint && p.available))
        return reply.code(403).send({ error: "browser_worker_required" });
      const bytes = this.assets.get(file);
      if (artifactId !== browserTextModel.files["model.onnx"].sha256 || !bytes) return reply.code(404).send();
      return reply.header("cache-control", "private, no-store").type("application/octet-stream").send(bytes);
    });
    app.addHook("onClose", async () => { this.close(); await this.reference?.close(); });
  }
  inputTokens(prompt: string): number {
    if (!this.tokenizer) throw new Error("browser_text_not_enabled");
    const length = this.tokenizer.encode(prompt).length;
    if (length < 1 || length > 128) throw new Error("browser_text_context_limit");
    return length;
  }
  handleMessage(workerId: string, type: string, payload: unknown) {
    const pending = this.pending.get(workerId); if (!pending) return;
    const body = payload as Record<string, unknown> | null;
    if (!body || body.taskId !== pending.taskId || body.leaseId !== pending.leaseId) return;
    if (type === "text.fail") { pending.reject(new Error("browser_text_worker_failed")); return; }
    const parsed = browserTextReplySchema.safeParse(payload);
    if (!parsed.success) { pending.reject(new Error("browser_text_invalid_result")); return; }
    pending.resolve(parsed.data.tokenIds);
  }
  disconnect(id: string) { this.pending.get(id)?.reject(new Error("browser_text_worker_disconnected")); }
  close() { for (const id of this.pending.keys()) this.disconnect(id); }
  async execute(workerId: string, request: BrowserTextRequest) {
    const peer = this.transport.peers().find(p => p.id === workerId && p.available && p.fingerprint);
    if (!this.directory || !peer || this.referenceBusy || !this.transport.acquire(workerId)) throw new Error("browser_contributor_unavailable");
    this.referenceBusy = true;
    const controller = new AbortController(), deadlineAt = Date.now() + 110_000;
    const artifactId = browserTextModel.files["model.onnx"].sha256;
    try {
      const taskId = randomUUID(), leaseId = randomUUID();
      const reply = new Promise<number[]>((resolveReply, rejectReply) => {
        const reject = (error: Error) => { controller.abort(); rejectReply(error); };
        const timer = setTimeout(() => reject(new Error("browser_text_deadline")), 110_000); timer.unref();
        this.pending.set(workerId, { taskId, leaseId, resolve: resolveReply, reject, timer });
      });
      // Attach rejection handling before loading the reference or awaiting any other operation.
      void reply.catch(() => undefined);
      this.transport.send(workerId, "text.execute", { taskId, leaseId, artifactId, request, deadlineAt });
      const ids = await reply;
      this.reference??=new BrowserTextReference(this.directory);
      const expected = await this.reference.generate(request, controller.signal);
      if (Date.now() >= deadlineAt || JSON.stringify(ids) !== JSON.stringify(expected.tokenIds)
        || !this.transport.peers().some(p => p.id === workerId && p.available && p.fingerprint === peer.fingerprint))
        throw new Error("browser_text_reference_mismatch");
      this.transport.verified(workerId);
      return { result: expected, evidenceDigest: sha256CanonicalEvidence({ schema: "mycellios-browser-text/1",
        workerId, fingerprint: peer.fingerprint, artifactId, request, result: expected }) };
    } finally {
      const pending = this.pending.get(workerId); if (pending) clearTimeout(pending.timer);
      this.pending.delete(workerId); controller.abort(); this.referenceBusy = false; this.transport.release(workerId);
    }
  }
}
