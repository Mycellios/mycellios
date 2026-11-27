/**
 * Compares the baseline and candidate memory rankers on the recall benchmark.
 *   npx tsx scripts/memory-recall-bench/run.ts [--split dev|holdout] [--cases]
 * Tune only on dev; report holdout. See specs/mico-memory-graph/spec.md.
 */
import { MEMORY_RECALL_BENCH } from "./dataset.js";
import { evaluate, summarize, type CaseResult } from "./evaluate.js";

const argv = process.argv.slice(2);
const splitArg = argv.includes("--split") ? argv[argv.indexOf("--split") + 1] : undefined;
const showCases = argv.includes("--cases");

const baseline = await evaluate(MEMORY_RECALL_BENCH, "baseline");
const candidate = await evaluate(MEMORY_RECALL_BENCH, "candidate");
const keep = (result: CaseResult) => !splitArg || result.split === splitArg;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
function row(label: string, filter: (result: CaseResult) => boolean) {
  const a = summarize(baseline.filter((result) => keep(result) && filter(result)));
  const b = summarize(candidate.filter((result) => keep(result) && filter(result)));
  if (!a.cases) return;
  const facts = a.withFacts
    ? `${a.complete}/${a.withFacts} → ${b.complete}/${b.withFacts}   facts ${percent(a.factRecall)} → ${percent(b.factRecall)}`
    : "";
  const chit = a.chitchat ? `   noisy chit-chat ${a.noisyChitchat}/${a.chitchat} → ${b.noisyChitchat}/${b.chitchat}` : "";
  console.log(`${label.padEnd(12)} n=${String(a.cases).padEnd(4)} ${facts}${chit}`);
}

for (const split of splitArg ? [splitArg] : ["dev", "holdout"]) {
  const inSplit = (result: CaseResult) => result.split === split;
  console.log(`\n== ${split} (complete cases baseline → candidate) ==`);
  row("all", inSplit);
  const tags = [...new Set(MEMORY_RECALL_BENCH.flatMap((vault) => vault.cases.flatMap((item) => item.tags)))].sort();
  for (const tag of tags) row(tag, (result) => inSplit(result) && result.tags.includes(tag));
  const a = summarize(baseline.filter(inSplit));
  const b = summarize(candidate.filter(inSplit));
  console.log(
    `noise/case ${a.meanNoise.toFixed(2)} → ${b.meanNoise.toFixed(2)}   bytes/case ${Math.round(a.meanBytes)} → ${Math.round(b.meanBytes)}   p95 ${a.p95Ms.toFixed(1)}ms → ${b.p95Ms.toFixed(1)}ms`,
  );
}

if (showCases) {
  console.log("\n== cases that changed ==");
  candidate.forEach((result, index) => {
    const before = baseline[index]!;
    if (!keep(result) || (before.found === result.found && before.noise === result.noise)) return;
    console.log(
      `${result.split.padEnd(8)} ${result.vault}/${result.id} [${result.tags.join(",")}] found ${before.found}→${result.found}/${result.facts} noise ${before.noise}→${result.noise}`,
    );
  });
}
