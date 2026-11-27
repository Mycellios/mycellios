import { MEMORY_RECALL_BENCH } from "./dataset.js";

/** Every fact must be literal text of a listed note, and every listed note must exist. */
export function datasetProblems(): string[] {
  const problems: string[] = [];
  for (const vault of MEMORY_RECALL_BENCH) {
    const notes = new Map(vault.notes.map((note) => [note.id, note]));
    if (notes.size !== vault.notes.length) problems.push(`${vault.id}: duplicate note id`);
    const ids = new Set<string>();
    for (const item of vault.cases) {
      if (ids.has(item.id)) problems.push(`${vault.id}/${item.id}: duplicate case id`);
      ids.add(item.id);
      for (const id of item.notes) if (!notes.has(id)) problems.push(`${vault.id}/${item.id}: unknown note ${id}`);
      for (const fact of item.facts)
        if (!item.notes.some((id) => notes.get(id)?.content.includes(fact)))
          problems.push(`${vault.id}/${item.id}: fact not in its notes: ${fact}`);
      if (!item.facts.length !== !item.notes.length) problems.push(`${vault.id}/${item.id}: facts and notes disagree`);
    }
  }
  return problems;
}
