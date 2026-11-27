/**
 * Candidate local memory recall (specs/mico-memory-graph). Deterministic and lexical, like
 * `rankLocalMemories`: no embeddings, model call or external service. It differs in four
 * ways that the recall benchmark measures before any Mico receives its output:
 *
 * - light Spanish/English stemming, so "perro" finds "perros" and "trabajo" finds "trabaja";
 * - passage scoring with BM25, so one line deep in a long MEMORY.md can win, and the excerpt
 *   keeps the best passages instead of the window around the first matching word;
 * - the previous user message as a weaker query for follow-ups such as "¿y ella?", ranked
 *   after every note that matches the current message;
 * - notes linked as [[name]] from a recalled note, after the notes that matched.
 */

const STOP = new Set(
  (
    "a al algo and con como de del el ella ellas ellos en es esta este esto for how la las lo los me mi my para por que se su the to un una y yo you " +
    "le les mis sus tu tus te ti unos unas ser fue era son muy mas pero sin sobre entre cuando donde quien cual cuales eso esa ese esas esos ya tambien " +
    "is are was were be of in on at it this that what which who with do does did i we they he she his her our your not no si md " +
    "hola hello hi hey gracias thanks thank vale ok okay porfa please favor"
  ).split(" "),
);

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const TITLE_WEIGHT = 2.5;
const PREVIOUS_MESSAGE_WEIGHT = 0.5;
const PREFIX_MATCH_WEIGHT = 0.6;
/**
 * Weaker matches are usually one common word ("días", "tarde"); chosen on the benchmark dev
 * split. Scores shrink with few notes (low IDF), so smaller vaults keep every match.
 */
const MIN_SCORE = 1.25;
const MIN_SCORE_FROM_NOTES = 8;

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Words of a text, folded and without stop words; hyphenated words also give their parts. */
export function recallWords(text: string, maximum = Number.POSITIVE_INFINITY): string[] {
  const words: string[] = [];
  for (const raw of fold(text).match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []) {
    const parts = /[_-]/.test(raw) ? [raw, ...raw.split(/[_-]+/)] : [raw];
    for (const word of parts) if (word.length >= 2 && !STOP.has(word)) words.push(word);
    if (words.length >= maximum) break;
  }
  return words;
}

/** Conservative suffix stripping shared by Spanish and English. */
export function recallStem(word: string): string {
  if (/^\d/.test(word)) return word;
  let stem = word;
  if (stem.length >= 8 && stem.endsWith("mente")) stem = stem.slice(0, -5);
  if (stem.length >= 7 && stem.endsWith("ing")) stem = stem.slice(0, -3);
  else if (stem.length >= 6 && stem.endsWith("ed")) stem = stem.slice(0, -2);
  if (stem.length >= 4 && stem.endsWith("s") && !stem.endsWith("ss")) stem = stem.slice(0, -1);
  if (stem.length >= 6 && /(?:ar|er|ir)$/.test(stem)) stem = stem.slice(0, -2);
  if (stem.length >= 4 && /[aeo]$/.test(stem)) stem = stem.slice(0, -1);
  return stem;
}

type Passage = { start: number; text: string; stems: Map<string, number>; length: number };

/**
 * One passage per non-empty line: Micos append one fact per line and write paragraphs and
 * list items as single lines. A line keeps the words of the heading above it.
 */
function passages(content: string): Passage[] {
  const result: Passage[] = [];
  let heading = "";
  let offset = 0;
  for (const line of content.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    if (!line.trim()) continue;
    if (/^#{1,6}\s/.test(line)) {
      heading = line.replace(/^#+\s*/, "");
      continue;
    }
    const words = recallWords(`${heading} ${line}`);
    if (!words.length) continue;
    const stems = new Map<string, number>();
    for (const word of words) {
      const stem = recallStem(word);
      stems.set(stem, (stems.get(stem) ?? 0) + 1);
    }
    result.push({ start, text: line, stems, length: words.length });
  }
  return result;
}

export type RecallQuery = { message: string; previousMessage?: string };
export type RecallHit<T> = {
  document: T;
  score: number;
  via: "match" | "link";
  /** Best passages first; the excerpt shows them in their original order. */
  passages: Array<{ start: number; text: string; score: number }>;
};

function queryTerms(query: RecallQuery): Map<string, number> {
  const terms = new Map<string, number>();
  for (const word of recallWords(query.message, 80)) terms.set(recallStem(word), 1);
  for (const word of recallWords(query.previousMessage ?? "", 80)) {
    const stem = recallStem(word);
    if (!terms.has(stem)) terms.set(stem, PREVIOUS_MESSAGE_WEIGHT);
  }
  return terms;
}

/** How strongly a query stem matches a stem in a note: exact, or a long shared prefix. */
function stemMatch(term: string, stem: string): number {
  if (term === stem) return 1;
  if (term.length >= 5 && stem.length >= 5 && (stem.startsWith(term) || term.startsWith(stem))) return PREFIX_MATCH_WEIGHT;
  return 0;
}

function linkTargets(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g)].map((match) => linkKey(match[1]!));
}

function linkKey(path: string): string {
  return fold(path.trim()).replace(/\\/g, "/").replace(/\.md$/, "");
}

/**
 * Ranks notes for one message. A note qualifies through its best passage (plus its path),
 * scored with BM25 over passages. Up to `linkLimit` notes linked as [[name]] from the first
 * three matches follow the matches, when they did not match themselves.
 */
export function recallMemories<T extends { path: string; content: string; updatedAt?: string | Date }>(
  documents: T[],
  query: RecallQuery,
  options: { limit?: number; linkLimit?: number; minScore?: number } = {},
): Array<RecallHit<T>> {
  const limit = options.limit ?? 5;
  const linkLimit = options.linkLimit ?? 2;
  const terms = queryTerms(query);
  if (!terms.size || !documents.length) return [];

  const notes = documents.map((document) => {
    const titleStems = new Set(recallWords(document.path.replace(/\.md$/i, "")).map(recallStem));
    return { document, titleStems, passages: passages(document.content) };
  });
  const allPassages = notes.flatMap((note) => note.passages);
  const averageLength = allPassages.reduce((sum, passage) => sum + passage.length, 0) / Math.max(1, allPassages.length);

  // Vocabulary matches per query term, computed once.
  const vocabulary = new Set<string>();
  for (const note of notes) {
    for (const stem of note.titleStems) vocabulary.add(stem);
    for (const passage of note.passages) for (const stem of passage.stems.keys()) vocabulary.add(stem);
  }
  const matches = new Map<string, Array<[string, number]>>();
  for (const term of terms.keys()) {
    const found: Array<[string, number]> = [];
    for (const stem of vocabulary) {
      const weight = stemMatch(term, stem);
      if (weight) found.push([stem, weight]);
    }
    matches.set(term, found);
  }
  // Document frequency counts notes, so a word repeated across one note's lines stays rare.
  const idf = new Map<string, number>();
  for (const [term, found] of matches) {
    const df = notes.filter(
      (note) =>
        found.some(([stem]) => note.titleStems.has(stem)) ||
        note.passages.some((passage) => found.some(([stem]) => passage.stems.has(stem))),
    ).length;
    idf.set(term, Math.log(1 + (notes.length - df + 0.5) / (df + 0.5)));
  }

  const scored = notes.map((note) => {
    let title = 0;
    // Whether the current message itself matched; the previous one only ranks within a tier.
    let current = false;
    for (const [term, weight] of terms) {
      const best = Math.max(0, ...matches.get(term)!.map(([stem, match]) => (note.titleStems.has(stem) ? match : 0)));
      title += best * weight * idf.get(term)! * TITLE_WEIGHT;
      if (best && weight === 1) current = true;
    }
    const ranked = note.passages
      .map((passage) => {
        let score = 0;
        for (const [term, weight] of terms) {
          let frequency = 0;
          for (const [stem, match] of matches.get(term)!) frequency += (passage.stems.get(stem) ?? 0) * match;
          if (!frequency) continue;
          if (weight === 1) current = true;
          const norm = BM25_K1 * (1 - BM25_B + (BM25_B * passage.length) / averageLength);
          score += weight * idf.get(term)! * ((frequency * (BM25_K1 + 1)) / (frequency + norm));
        }
        return { start: passage.start, text: passage.text, score };
      })
      .filter((passage) => passage.score > 0)
      .sort((a, b) => b.score - a.score || a.start - b.start);
    // The best passage decides; further matching passages add a little.
    const rest = ranked.slice(1, 4).reduce((sum, passage) => sum + passage.score, 0);
    return { note, current, score: title + (ranked[0]?.score ?? 0) + 0.25 * rest, passages: ranked };
  });

  const newest = (a: T, b: T) => Date.parse(String(b.updatedAt ?? "")) - Date.parse(String(a.updatedAt ?? ""));
  const matched = scored
    .filter((row) => row.score > 0 && (notes.length < MIN_SCORE_FROM_NOTES || row.score >= (options.minScore ?? MIN_SCORE)))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.score - a.score || newest(a.note.document, b.note.document) || a.note.document.path.localeCompare(b.note.document.path))
    .slice(0, limit);

  const hits: Array<RecallHit<T>> = matched.map((row) => ({
    document: row.note.document,
    score: row.score,
    via: "match",
    passages: row.passages,
  }));
  if (linkLimit <= 0) return hits;

  const byKey = new Map<string, (typeof notes)[number]>();
  for (const note of notes) {
    const key = linkKey(note.document.path);
    byKey.set(key, note);
    const base = key.split("/").pop()!;
    if (!byKey.has(base)) byKey.set(base, note);
  }
  const chosen = new Set(hits.map((hit) => hit.document));
  const linked: Array<RecallHit<T>> = [];
  for (const hit of hits.slice(0, 3)) {
    for (const target of linkTargets(hit.document.content)) {
      const note = byKey.get(target) ?? byKey.get(target.split("/").pop()!);
      if (!note || chosen.has(note.document) || linked.length >= linkLimit) continue;
      chosen.add(note.document);
      const own = scored.find((row) => row.note === note)!;
      linked.push({ document: note.document, score: hit.score / 2, via: "link", passages: own.passages });
    }
  }
  return [...hits, ...linked];
}

/**
 * The note itself when it fits, otherwise its best passages (or its beginning, for a linked
 * note that matched nothing) in their original order. Omissions are marked with "…".
 */
export function recallExcerpt(content: string, hit: Pick<RecallHit<unknown>, "passages">, maximum = 2200): string {
  if (content.length <= maximum) return content;
  const picked: Array<{ start: number; text: string }> = [];
  let used = 0;
  for (const passage of hit.passages) {
    const text = passage.text.length > maximum - used ? passage.text.slice(0, Math.max(0, maximum - used)) : passage.text;
    if (!text) break;
    picked.push({ start: passage.start, text });
    used += text.length + 2;
    if (used >= maximum) break;
  }
  if (!picked.length) picked.push({ start: 0, text: content.slice(0, maximum) });
  picked.sort((a, b) => a.start - b.start);
  return picked
    .map((passage, index) => {
      const previous = picked[index - 1];
      const gap = index === 0 ? passage.start > 0 : passage.start > previous!.start + previous!.text.length + 1;
      return `${gap ? "…\n" : ""}${passage.text}`;
    })
    .join("\n")
    .concat(picked.at(-1)!.start + picked.at(-1)!.text.length < content.trimEnd().length ? "\n…" : "");
}
