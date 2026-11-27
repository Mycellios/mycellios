import { performance } from "node:perf_hooks";
import type { AdapterContext, MemoryStore } from "@mycellios/adapter-kit";
import { loadAgentMemoryContext, type MemoryRanker } from "../../packages/adapters/src/memory-context.js";
import type { BenchCase, BenchVault } from "./dataset.js";

/**
 * Offline recall benchmark (specs/mico-memory-graph). Each case renders the real durable
 * memory block with one ranker and checks which needed facts reached it. No model,
 * network or database: the store is the vault in memory.
 */
export type CaseResult = {
  vault: string;
  id: string;
  split: BenchCase["split"];
  tags: string[];
  /** Needed facts that reached the block, of `facts`. */
  found: number;
  facts: number;
  /** Searchable notes placed that the case does not need. */
  noise: number;
  bytes: number;
  ms: number;
};

const context: AdapterContext = {
  operationId: "bench",
  traceId: "bench",
  spaceId: "bench",
  userId: "bench",
  botId: "bench",
  runId: "bench",
  signal: new AbortController().signal,
};

function storeFor(vault: BenchVault): MemoryStore {
  const documents = (scope: "bot" | "user") =>
    vault.notes
      .filter((note) => note.scope === scope)
      .map((note) => ({
        id: note.id,
        path: note.path,
        content: note.content,
        revision: 1,
        updatedAt: note.updatedAt,
        inclusion: note.inclusion ?? "searchable",
        userControlled: false,
        taskThreadId: null,
      }));
  return { read: async ({ scope }: { scope: "bot" | "user" }) => ({ documents: documents(scope) }) } as unknown as MemoryStore;
}

const unescape = (text: string) => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

export async function evaluate(vaults: BenchVault[], ranker: MemoryRanker): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const vault of vaults) {
    const store = storeFor(vault);
    const essential = new Set(vault.notes.filter((note) => note.inclusion === "essential").map((note) => note.id));
    for (const item of vault.cases) {
      let included: string[] = [];
      const started = performance.now();
      const block = unescape(
        (await loadAgentMemoryContext(store, "bench", context, undefined, {
          query: item.message,
          ...(item.previousUserMessage ? { previousQuery: item.previousUserMessage } : {}),
          ranker,
          onIncluded: (ids) => {
            included = ids;
          },
        })) ?? "",
      );
      const ms = performance.now() - started;
      results.push({
        vault: vault.id,
        id: item.id,
        split: item.split,
        tags: item.tags,
        found: item.facts.filter((fact) => block.includes(fact)).length,
        facts: item.facts.length,
        noise: included.filter((id) => !essential.has(id) && !item.notes.includes(id)).length,
        bytes: Buffer.byteLength(block),
        ms,
      });
    }
  }
  return results;
}

export type Summary = {
  cases: number;
  /** Cases with facts where every fact reached the block. */
  complete: number;
  withFacts: number;
  /** Facts that reached the block, of all needed facts. */
  factRecall: number;
  /** Chit-chat cases (no facts needed) that still received searchable notes. */
  noisyChitchat: number;
  chitchat: number;
  meanNoise: number;
  meanBytes: number;
  p95Ms: number;
};

export function summarize(results: CaseResult[]): Summary {
  const withFacts = results.filter((result) => result.facts > 0);
  const chitchat = results.filter((result) => result.facts === 0);
  const facts = withFacts.reduce((sum, result) => sum + result.facts, 0);
  const times = results.map((result) => result.ms).sort((a, b) => a - b);
  return {
    cases: results.length,
    complete: withFacts.filter((result) => result.found === result.facts).length,
    withFacts: withFacts.length,
    factRecall: facts ? withFacts.reduce((sum, result) => sum + result.found, 0) / facts : 0,
    noisyChitchat: chitchat.filter((result) => result.noise > 0).length,
    chitchat: chitchat.length,
    meanNoise: results.reduce((sum, result) => sum + result.noise, 0) / Math.max(1, results.length),
    meanBytes: results.reduce((sum, result) => sum + result.bytes, 0) / Math.max(1, results.length),
    p95Ms: times[Math.floor(times.length * 0.95)] ?? 0,
  };
}
