import type * as Ort from "onnxruntime-web";
import { browserTextRequestSchema, browserTextResultSchema, type BrowserTextResult } from "../contracts/browser-text.js";
import { Gpt2Tokenizer } from "./gpt2-tokenizer.js";

/** Full pretrained GPT-2 decode: all transformer layers and the language head, greedy, no sampling. */
export class BrowserTextDecoder {
  private busy = false;
  constructor(private readonly ort: typeof Ort, private readonly session: Ort.InferenceSession,
    readonly tokenizer: Gpt2Tokenizer) {}
  static async load(ort: typeof Ort, graph: Uint8Array, vocab: string, merges: string) {
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(graph, { executionProviders: ["wasm"], executionMode: "sequential" });
    if (session.inputNames.some(name => !["input_ids", "attention_mask", "position_ids"].includes(name)) || !session.outputNames.includes("logits")) {
      await session.release(); throw new Error("browser_text_graph_interface_invalid");
    }
    return new BrowserTextDecoder(ort, session, new Gpt2Tokenizer(vocab, merges));
  }
  inputTokens(prompt: string) {
    const ids = this.tokenizer.encode(prompt);
    if (ids.length < 1 || ids.length > 128) throw new Error("browser_text_context_limit");
    return ids;
  }
  async generate(candidate: unknown, signal: AbortSignal): Promise<BrowserTextResult> {
    const request = browserTextRequestSchema.parse(candidate);
    if (this.busy) throw new Error("browser_text_busy");
    const ids = this.inputTokens(request.prompt), promptTokens = ids.length, generated: number[] = [];
    this.busy = true;
    try {
      while (generated.length < request.maxTokens) {
        signal.throwIfAborted();
        const feeds: Record<string, Ort.Tensor> = {};
        for (const name of this.session.inputNames) {
          const values = name === "input_ids" ? ids : name === "attention_mask" ? ids.map(() => 1) : ids.map((_, i) => i);
          feeds[name] = new this.ort.Tensor("int64", BigInt64Array.from(values.map(BigInt)), [1, ids.length]);
        }
        let outputs: Ort.InferenceSession.OnnxValueMapType | undefined;
        try {
          outputs = await this.session.run(feeds, ["logits"]);
          signal.throwIfAborted();
          const logits = outputs.logits!;
          if (logits.type !== "float32" || logits.dims.at(-1) !== 50257) throw new Error("browser_text_logits_invalid");
          const data = await logits.getData() as Float32Array, offset = data.length - 50257;
          let winner = 0, maximum = -Infinity;
          for (let id = 0; id < 50257; id++) {
            const value = data[offset + id]!;
            if (!Number.isFinite(value)) throw new Error("browser_text_logits_invalid");
            if (value > maximum) { maximum = value; winner = id; }
          }
          generated.push(winner); ids.push(winner);
          if (winner === 50256) break;
        } finally {
          Object.values(feeds).forEach(t => t.dispose());
          if (outputs) Object.values(outputs).forEach(t => t.dispose());
        }
      }
      return browserTextResultSchema.parse({ text: this.tokenizer.decode(generated), tokenIds: generated,
        inputTokens: promptTokens, finishReason: generated.at(-1) === 50256 ? "stop" : "length" });
    } finally { this.busy = false; }
  }
  async close() { await this.session.release(); }
}
