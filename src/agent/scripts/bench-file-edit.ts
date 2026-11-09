import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { applyFileEdit, sliceFileContent } from "../packages/adapters/src/file-edit.js";

const LINES = 2_000;
const START = 1_000;
const OLD_BLOCK = "const MAX_RETRIES = 3;\nconst TIMEOUT_MS = 1000;";
const NEW_BLOCK = "const MAX_RETRIES = 5;\nconst TIMEOUT_MS = 2000;";

const lines = Array.from({ length: LINES }, (_, index) => {
  const line = index + 1;
  if (line === START) return "const MAX_RETRIES = 3;";
  if (line === START + 1) return "const TIMEOUT_MS = 1000;";
  return `export const value${line} = ${line}; // filler line`;
});
const original = `${lines.join("\n")}\n`;

const directory = await mkdtemp(path.join(tmpdir(), "mycellios-edit-bench-"));
const file = path.join(directory, "config.ts");
await writeFile(file, original, "utf8");

const fullBytes = Buffer.byteLength(original);
const window = sliceFileContent(original, START - 20, 40);
const windowBytes = Buffer.byteLength(window.content);
const editBytes = Buffer.byteLength(OLD_BLOCK + NEW_BLOCK);
const estimateTokens = (bytes: number) => Math.ceil(bytes / 4);

for (let index = 0; index < 5; index += 1) sliceFileContent(original, START - 20, 40);
const timings: number[] = [];
for (let index = 0; index < 50; index += 1) {
  const started = performance.now();
  const slice = sliceFileContent(original, START - 20, 40);
  const result = applyFileEdit({
    content: slice.content,
    oldString: OLD_BLOCK,
    newString: NEW_BLOCK,
  });
  if (!result.ok) throw new Error(result.error);
  timings.push(performance.now() - started);
}
timings.sort((a, b) => a - b);

const verification = applyFileEdit({
  content: original,
  oldString: OLD_BLOCK,
  newString: NEW_BLOCK,
});
if (!verification.ok) throw new Error(verification.error);
await writeFile(file, verification.content, "utf8");
const applied = await readFile(file, "utf8");

const oldFlow = { bytes: fullBytes * 2, tokens: estimateTokens(fullBytes * 2) };
const newFlow = { bytes: windowBytes + editBytes, tokens: estimateTokens(windowBytes + editBytes) };

console.log(
  JSON.stringify(
    {
      fixture: { file, lines: LINES, bytes: fullBytes },
      oldWholeFileFlow: oldFlow,
      newRangeEditFlow: newFlow,
      contextReduction: `${(oldFlow.tokens / newFlow.tokens).toFixed(1)}x fewer tokens`,
      harness: {
        medianMs: Number(timings[Math.floor(timings.length / 2)]!.toFixed(3)),
        runs: timings.length,
      },
      slice: {
        startLine: window.startLine,
        endLine: window.endLine,
        totalLines: window.totalLines,
        truncated: window.truncated,
        bytes: windowBytes,
      },
      editCorrect: applied === original.replace(OLD_BLOCK, NEW_BLOCK),
    },
    null,
    2,
  ),
);
