/**
 * Where a Mico's edit landed, derived only from the file before and after a write, so the
 * owner's preview can place that Mico's cursor. Never reads content into the signal.
 */
export type PresenceTarget = { kind: "selector" | "file"; value: string };

const MAX_SELECTOR = 512;
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

type Element = { tag: string; id?: string; nth: number };
type Token = { at: number; path: Element[] };

/**
 * Each start tag with its element path. Tolerant of malformed markup: unmatched end tags
 * close up to the nearest open element of that name, and raw-text elements are skipped.
 */
function htmlTokens(source: string): Token[] {
  const tokens: Token[] = [];
  const stack: { element: Element; counts: Map<string, number> }[] = [];
  const rootCounts = new Map<string, number>();
  const tagPattern =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?]]>|<![^>]*>|<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;
  for (let match = tagPattern.exec(source); match; match = tagPattern.exec(source)) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    if (match[0].startsWith("</")) {
      const open = stack.findLastIndex((entry) => entry.element.tag === name);
      if (open >= 0) stack.length = open;
      continue;
    }
    const counts = stack.at(-1)?.counts ?? rootCounts;
    const nth = (counts.get(name) ?? 0) + 1;
    counts.set(name, nth);
    const id = match[2]?.match(/\sid\s*=\s*["']?([A-Za-z][\w-]*)/)?.[1];
    const element: Element = { tag: name, nth, ...(id ? { id } : {}) };
    const path = [...stack.map((entry) => entry.element), element];
    tokens.push({ at: match.index, path });
    const selfClosing = /\/\s*$/.test(match[2] ?? "");
    if (VOID_TAGS.has(name) || selfClosing) continue;
    if (RAW_TEXT.has(name)) {
      const close = source.toLowerCase().indexOf(`</${name}`, tagPattern.lastIndex);
      tagPattern.lastIndex = close < 0 ? source.length : close;
    }
    stack.push({ element, counts: new Map() });
  }
  return tokens;
}

/** A CSS path for an element, anchored at its nearest id or at body. */
export function selectorFor(path: Element[]): string | undefined {
  const parts: string[] = [];
  for (let index = path.length - 1; index >= 0; index--) {
    const element = path[index]!;
    if (element.id) {
      parts.unshift(`#${element.id}`);
      break;
    }
    if (element.tag === "body" || element.tag === "html" || element.tag === "head") {
      if (element.tag === "body") parts.unshift("body");
      break;
    }
    parts.unshift(`${element.tag}:nth-of-type(${element.nth})`);
  }
  if (!parts.length || path.some((element) => element.tag === "head")) return undefined;
  const selector = parts.join(" > ");
  return selector.length <= MAX_SELECTOR ? selector : undefined;
}

/** The innermost element containing the first character that differs between versions. */
export function changedHtmlSelector(before: string, after: string): string | undefined {
  if (before === after) return undefined;
  let first = 0;
  const limit = Math.min(before.length, after.length);
  while (first < limit && before[first] === after[first]) first++;
  const tokens = htmlTokens(after);
  let path: Element[] | undefined;
  // The last start tag at or before the change; skip ahead past elements that closed.
  for (const token of tokens) {
    if (token.at > first) break;
    path = token.path;
  }
  // A change before any tag (or inside the head) points at the first body element.
  path ??= tokens.find((token) => token.path.some((element) => element.tag === "body"))?.path;
  return path ? selectorFor(path) : undefined;
}

function cssRules(source: string): { selector: string; text: string }[] {
  const rules: { selector: string; text: string }[] = [];
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let start = 0;
  let selector = "";
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (char === "{") {
      if (depth === 0) {
        selector = clean.slice(start, index).trim();
        start = index + 1;
      }
      depth++;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        rules.push({ selector, text: clean.slice(start, index) });
        start = index + 1;
      }
    }
  }
  return rules;
}

/** The selector of the first rule that was added or changed, if it is a plain selector. */
export function changedCssSelector(before: string, after: string): string | undefined {
  const old = cssRules(before);
  const next = cssRules(after);
  const changed = next.find(
    (rule, index) => old[index]?.selector !== rule.selector || old[index]?.text !== rule.text,
  );
  const selector = changed?.selector.split(",")[0]?.trim();
  if (!selector || selector.startsWith("@") || selector.length > MAX_SELECTOR) return undefined;
  return selector;
}

export function presenceTarget(path: string, before: string, after: string): PresenceTarget {
  const selector = /\.html?$/i.test(path)
    ? changedHtmlSelector(before, after)
    : /\.css$/i.test(path)
      ? changedCssSelector(before, after)
      : undefined;
  return selector ? { kind: "selector", value: selector } : { kind: "file", value: path };
}
