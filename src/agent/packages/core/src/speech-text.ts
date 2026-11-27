import type { MessageBlock } from "@mycellios/contracts";

/** A fenced block becomes a mention of itself, with its language if known. */
function describeCodeBlock(fence: string): string {
  const lang =
    fence
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^a-z0-9+#]/gi, "") ?? "";
  const spoken: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    json: "JSON",
    yml: "YAML",
    yaml: "YAML",
    sql: "SQL",
    rs: "Rust",
    go: "Go",
    swift: "Swift",
    diff: "diff",
  };
  const name = spoken[lang.toLowerCase()];
  return name ? `. (a ${name} code block) ` : ". (a code block) ";
}

/** `a/b/c/file.ts` → `file.ts`. A path's directories are for the eye. */
function shortenPaths(text: string): string {
  return text.replace(/(?:[\w.@-]+\/){1,}([\w.-]+\.\w{1,6})\b/g, "$1");
}

const ENDS_SENTENCE = /[.!?:;]\s*$/;

/**
 * Markdown (or any agent output) → a line a voice can read.
 *
 * Say the prose, name the artifacts, drop the syntax. Pure and synchronous
 * so it stays easy to tune against real transcripts.
 */
export function speakable(input: string): string {
  if (!input) return "";
  let text = input;

  text = text.replace(/```([^\n]*)\n[\s\S]*?(?:```|$)/g, (_m, fence: string) =>
    describeCodeBlock(fence),
  );
  text = text.replace(/~~~([^\n]*)\n[\s\S]*?(?:~~~|$)/g, (_m, fence: string) =>
    describeCodeBlock(fence),
  );

  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) =>
    alt ? `. (image: ${alt}) ` : ". (an image) ",
  );
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/<https?:\/\/[^>\s]+>/g, " a link ");
  text = text.replace(/\bhttps?:\/\/\S+/g, " a link ");

  text = text.replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, "");
  text = text.replace(/^\s*\|(.+)\|\s*$/gm, (_m, row: string) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", "),
  );

  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    code.length <= 40 ? code : " that snippet ",
  );

  text = text.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_m, head: string) =>
    ENDS_SENTENCE.test(head) ? head : `${head.trim()}.`,
  );

  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^\s*(?:[-*_]\s*){3,}$/gm, "");

  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  text = text.replace(/\[[ xX]\]\s*/g, "");

  text = shortenPaths(text);

  text = text.replace(
    /[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    "",
  );

  text = text.replace(/\n{2,}/g, ". ");
  text = text.replace(/\n/g, ". ");

  text = text.replace(/\s+/g, " ");
  text = text.replace(/\s+([.,!?;:])/g, "$1");
  text = text.replace(/(?:\.\s*){2,}/g, ". ");
  text = text.replace(/,\s*\./g, ".");
  text = text.trim();

  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

const BOUNDARY =
  /(?<!\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|No|approx))(?<![.\d])([.!?])(["')\]]*)\s+/g;

/**
 * Split speakable text into utterances a synthesizer can start on.
 * Short fragments are glued onto their neighbour so the voice keeps context.
 */
export function toUtterances(input: string, { minChars = 12, maxChars = 320 } = {}): string[] {
  const text = speakable(input);
  if (!text) return [];

  const MARK = "\u0000";
  const rough = text
    .replace(BOUNDARY, `$1$2${MARK}`)
    .split(MARK)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const piece of rough) {
    const parts = piece.length <= maxChars ? [piece] : splitLong(piece, maxChars);
    for (const part of parts) {
      const prev = out[out.length - 1];
      if (prev && (prev.length < minChars || part.length < minChars)) {
        out[out.length - 1] = `${prev} ${part}`;
      } else {
        out.push(part);
      }
    }
  }
  return out;
}

function splitLong(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const at = Math.max(
      window.lastIndexOf(", "),
      window.lastIndexOf("; "),
      window.lastIndexOf(" — "),
    );
    const cut = at > maxChars / 2 ? at + 1 : window.lastIndexOf(" ");
    if (cut <= 0) break;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** A tool-activity chip as a spoken progress line. Null when it is not worth hearing. */
export function narrateTool(toolName: string): string | null {
  const name = toolName.replace(/^mcp__[^_]+__/, "").trim();
  if (!name) return null;
  if (/^(auto-approved|error):/i.test(name)) return null;

  const bare = name.toLowerCase();
  const verbs: Array<[RegExp, string]> = [
    [/^(bash|shell|terminal|run_command|execute|computer_exec)$/, "running a command"],
    [/^(read|read_file|view|list_files)$/, "reading a file"],
    [/^(write|write_file|create_file)$/, "writing a file"],
    [/^(edit|edit_file|patch_file)$/, "editing a file"],
    [/^(edit|apply_patch|str_replace|multiedit)$/, "editing a file"],
    [/^(grep|search|glob|find)$/, "searching"],
    [/^(web_?search|websearch)$/, "searching the web"],
    [/^(web_?fetch|fetch)$/, "reading a page"],
    [/^(screenshot|computer_observe)$/, "looking at the screen"],
    [/^(browser_navigate|browser_snapshot|browser_act)$/, "using the page"],
    [/^chrome_tabs$/, "looking at your tabs"],
    [/^chrome_snapshot$/, "reading your page"],
    [/^chrome_screenshot$/, "looking at your page"],
    [/^(chrome_navigate|chrome_act)$/, "using your browser"],
    [/^(click|type_text|press_key|scroll|computer_batch|computer_act)$/, "using the computer"],
    [/^open_url$/, "opening a page"],
    [/^list_bots$/, "checking who's around"],
    [/^ask_bot$/, "asking a teammate"],
    [/^run_subagent$/, "starting a subagent"],
    [/^spawn_bot$/, "creating a bot"],
    [/^create_space$/, "creating a space"],
    [/^list_fleet$/, "checking your bots"],
    [/^create_group$/, "creating a group"],
    [/^update_group$/, "updating a group"],
    [/^organize_bot$/, "organizing the sidebar"],
    [/^set_child_instructions$/, "rewriting a bot's instructions"],
    [/^set_child_bot_model$/, "setting a bot's model"],
    [/^create_child_routine$/, "scheduling a routine"],
    [/^(archive_bot|delete_bot)$/, "archiving a bot"],
    [/^remember$/, "writing a memory"],
    [/^save_shared_memory$/, "saving shared memory"],
    [/^attach_file$/, "attaching a file"],
    [/^request_takeover$/, "asking you to take over"],
    [/^acknowledge_request$/, "sharing a plan"],
  ];
  for (const [pattern, phrase] of verbs) {
    if (pattern.test(bare)) return phrase;
  }
  const short = shortenPaths(name).slice(0, 40);
  return /^[\w .:/-]+$/.test(short) ? `running ${short}` : null;
}

export function speechFromBlocks(blocks: MessageBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "text" || block.kind === "progress" || block.kind === "meta")
        return block.text;
      if (block.kind === "ask") return block.text;
      if (block.kind === "cloud_agent")
        return `${block.title}: ${block.status}${block.prUrl ? ` ${block.prUrl}` : ""}`;
      if (block.kind === "computer") return block.text;
      if (block.kind === "subagent") {
        if (block.status === "running") return `${block.name} is working on ${block.task}`;
        if (block.status === "failed") return `${block.name} failed`;
        return block.result || `${block.name} finished`;
      }
      if (block.kind === "card") {
        return block.lines.map((line) => `${line.k}: ${line.v}`).join(". ");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

// Whole-utterance phrases only: "si me dices qué es" or "sure, but first…" must never count.
const YES_PHRASES = [
  "yes",
  "yeah",
  "yep",
  "yup",
  "ok",
  "okay",
  "sure",
  "do it",
  "go ahead",
  "approve",
  "approved",
  "allow it",
  "confirmed",
  "affirmative",
  "go for it",
  "si",
  "vale",
  "claro",
  "de acuerdo",
  "adelante",
  "hazlo",
  "dale",
  "venga",
  "correcto",
  "confirmo",
  "confirmado",
  "apruebalo",
  "permitelo",
  "perfecto",
  "por supuesto",
];
const NO_PHRASES = [
  "no",
  "nope",
  "nah",
  "cancel",
  "cancel it",
  "stop",
  "don't",
  "dont",
  "do not",
  "don't do it",
  "reject",
  "deny",
  "deny it",
  "negative",
  "not now",
  "no lo hagas",
  "cancela",
  "cancelalo",
  "para",
  "deniega",
  "denegado",
  "rechaza",
  "rechazalo",
  "mejor no",
  "ahora no",
  "de ninguna manera",
];
const FILLER = new Set(["thanks", "thank you", "please", "gracias", "por favor"]);

function decisionUnits(transcript: string): string[] | null {
  const text = transcript
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ",")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const units = text
    .split(",")
    .map((unit) => unit.trim())
    .filter(Boolean);
  return units.length > 0 && units.length <= 4 ? units : null;
}

/**
 * A clear spoken yes or no, in English or Spanish. Every comma-separated part of the utterance
 * must itself be a yes (or a no) phrase, or politeness: consent is never inferred from a
 * sentence that merely contains "sure" or starts with "si".
 */
export function spokenDecision(transcript: string): "yes" | "no" | null {
  const units = decisionUnits(transcript);
  if (!units) return null;
  const classify = (unit: string): "yes" | "no" | "filler" | null => {
    if (FILLER.has(unit)) return "filler";
    if (YES_PHRASES.includes(unit)) return "yes";
    if (NO_PHRASES.includes(unit)) return "no";
    // "si hazlo", "no thanks", "yes please": a phrase followed by more of the same kind.
    const words = unit.split(" ");
    for (let cut = words.length - 1; cut >= 1; cut -= 1) {
      const head = classify(words.slice(0, cut).join(" "));
      const tail = classify(words.slice(cut).join(" "));
      if (head && head !== "filler" && (tail === head || tail === "filler")) return head;
    }
    return null;
  };
  const kinds = new Set(units.map(classify));
  kinds.delete("filler");
  if (kinds.size !== 1 || kinds.has(null)) return null;
  return kinds.has("yes") ? "yes" : "no";
}

/**
 * The approval action a spoken answer selects: a clear yes allows once, a clear no denies.
 * "Always allow" is never chosen by voice; it stays a deliberate tap on screen.
 */
export function spokenApprovalAction(
  transcript: string,
  actions: readonly { id: string }[] | undefined,
): "allow" | "deny" | null {
  const ids = new Set(actions?.map((action) => action.id));
  const decision = spokenDecision(transcript);
  if (decision === "yes" && ids.has("allow")) return "allow";
  if (decision === "no" && ids.has("deny")) return "deny";
  return null;
}

const VOCABULARY_MAX_NAMES = 24;
const VOCABULARY_MAX_CHARS = 400;

function spokenWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Names a speech model should expect (the Mico, its teammates, the product), deduplicated and
 * bounded, ready to pass as a transcription prompt. Empty when there is nothing to hint.
 */
export function transcriptionVocabulary(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    const key = spokenWords(name).join(" ");
    if (!key || name.length > 60 || seen.has(key)) continue;
    if (out.length >= VOCABULARY_MAX_NAMES || chars + name.length + 2 > VOCABULARY_MAX_CHARS) break;
    seen.add(key);
    out.push(name);
    chars += name.length + 2;
  }
  return out;
}

/**
 * True when a transcript only recites the hinted names (at least two of them, and no other
 * word): speech models return their prompt for short or unclear sounds, and that is not
 * something the person said.
 */
export function isVocabularyEcho(transcript: string, vocabulary: readonly string[]): boolean {
  const words = spokenWords(transcript);
  if (words.length === 0) return false;
  const names = vocabulary.map((name) => spokenWords(name)).filter((name) => name.length > 0);
  const matched = new Set<number>();
  let index = 0;
  while (index < words.length) {
    let advanced = 0;
    names.forEach((name, nameIndex) => {
      if (advanced >= name.length) return;
      if (name.every((word, offset) => words[index + offset] === word)) {
        advanced = name.length;
        matched.add(nameIndex);
      }
    });
    if (!advanced) return false;
    index += advanced;
  }
  return matched.size >= 2;
}
