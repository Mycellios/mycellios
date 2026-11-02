import { spawn } from "node:child_process";
import { z } from "zod";

const MAX_BYTES = 8 * 1024 * 1024;
const stageSchema = z.object({
  deviceId: z.string().min(1),
  layerStart: z.number().int().nonnegative(),
  layerEnd: z.number().int().positive(),
  backend: z.string().min(1),
  hostBytes: z.number().int().positive().safe(),
  vramBytes: z.number().int().nonnegative().safe(),
}).passthrough();
const routeSchema = z.object({
  candidateId: z.string().min(1),
  executionKey: z.string().regex(/^[a-f0-9]{64}$/),
  stages: z.array(stageSchema).min(1),
  medianRequestMs: z.number().positive().finite(),
  sampleCount: z.number().int().min(3),
}).strict();
const selectionSchema = z.object({
  feasible: z.boolean(),
  selected: routeSchema.nullable(),
  qualified: z.array(routeSchema),
  rejected: z.array(z.object({ candidateId: z.string(), reason: z.string() }).strict()),
}).strict();

export type DenseMeasuredSelection = z.infer<typeof selectionSchema>;

/** Caller must provide authenticated inventory and immutable request receipts. */
export async function selectMeasuredDenseRoute(
  document: unknown,
  runtime: { pythonExecutable: string; cwd: string; environment?: NodeJS.ProcessEnv },
): Promise<DenseMeasuredSelection> {
  const encoded = JSON.stringify(document);
  if (encoded === undefined || Buffer.byteLength(encoded) > MAX_BYTES) {
    throw new Error("dense_selection_input_invalid");
  }
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(runtime.pythonExecutable,
      ["-c", "import sys,runpy; from importlib.machinery import PathFinder; "
        + "from pathlib import Path; spec=PathFinder.find_spec('distributed_runtime',sys.path); "
        + "assert spec is not None and spec.submodule_search_locations; "
        + "runpy.run_path(str(Path(next(iter(spec.submodule_search_locations))) / 'dense_request_selection_cli.py'),run_name='__main__')"], {
        cwd: runtime.cwd, env: runtime.environment ?? process.env,
        stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); }
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(() => finish(new Error("dense_selection_timeout")), 15_000);
    child.on("error", () => finish(new Error("dense_selection_runtime_unavailable")));
    child.stdin.on("error", () => finish(new Error("dense_selection_input_failed")));
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) finish(new Error("dense_selection_output_too_large"));
      else chunks.push(chunk);
    });
    // Drain diagnostics without exposing model receipts or retaining unbounded data.
    child.stderr.resume();
    child.on("close", (code) => finish(code === 0 ? undefined : new Error("dense_selection_failed")));
    child.stdin.end(encoded);
  });
  const parsed: unknown = JSON.parse(output);
  const result = selectionSchema.parse(parsed);
  if (result.feasible !== (result.selected !== null)
      || result.feasible !== (result.qualified.length > 0)
      || (result.selected !== null
          && JSON.stringify(result.selected) !== JSON.stringify(result.qualified[0]))) {
    throw new Error("dense_selection_inconsistent");
  }
  return result;
}
