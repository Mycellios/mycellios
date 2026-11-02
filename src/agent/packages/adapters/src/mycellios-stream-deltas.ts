import { randomUUID } from "node:crypto";

export type MycelliosDelta = {
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function: { name?: string; arguments?: string };
  }>;
};

const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";

/** Locate an actual JSON value boundary without fabricating closing braces. */
function valueEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') {
        quoted = false;
        if (depth === 0) return i + 1;
      }
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      if (--depth === 0) return i + 1;
    } else if (depth === 0 && (char === "," || /\s/.test(char ?? ""))) return i;
  }
  return undefined;
}

function whitespace(text: string, start: number) {
  while (start < text.length && /\s/.test(text[start] ?? "")) start++;
  return start;
}

function callFields(text: string, start: number) {
  if (text[start] !== "{") throw new Error("Tool calls require a JSON object.");
  let cursor = start + 1;
  let name: string | undefined;
  let args: string | undefined;
  const seen = new Set<string>();
  while (true) {
    cursor = whitespace(text, cursor);
    if (cursor === text.length) return { name, args };
    if (text[cursor] === "}") return { name, args, end: cursor + 1 };
    if (text[cursor] !== '"') throw new Error("Invalid tool property.");
    const keyEnd = valueEnd(text, cursor);
    if (keyEnd === undefined) return { name, args };
    const key: unknown = JSON.parse(text.slice(cursor, keyEnd));
    if ((key !== "name" && key !== "arguments") || seen.has(key))
      throw new Error("Unexpected or duplicate tool property.");
    seen.add(key);
    cursor = whitespace(text, keyEnd);
    if (cursor === text.length) return { name, args };
    if (text[cursor] !== ":") throw new Error("Invalid tool property separator.");
    cursor = whitespace(text, cursor + 1);
    if (cursor === text.length) return { name, args };
    const end = valueEnd(text, cursor);
    if (key === "arguments") {
      if (text[cursor] !== "{") throw new Error("Tool arguments require an object.");
      args = text.slice(cursor, end ?? text.length);
    } else if (end !== undefined) {
      const parsed: unknown = JSON.parse(text.slice(cursor, end));
      if (typeof parsed !== "string") throw new Error("Invalid tool name.");
      name = parsed;
    }
    if (end === undefined) return { name, args };
    cursor = whitespace(text, end);
    if (cursor === text.length) return { name, args };
    if (text[cursor] === "}") return { name, args, end: cursor + 1 };
    if (text[cursor] !== ",") throw new Error("Invalid tool separator.");
    cursor++;
  }
}

/** Real model deltas only. Tool validity is still checked before a terminal frame. */
export class MycelliosStreamDeltas {
  text = "";
  private mode: "plain" | "tools" | undefined;
  private contentStart: number | undefined;
  private reasoningSent = 0;
  private plainSent = 0;
  private cursor = 0;
  private calls = 0;
  private current: { id: string; sent: number; name?: string; announced: boolean } | undefined;

  constructor(
    private allowedNames: readonly string[],
    private parallel: boolean,
  ) {}

  push(delta: string): MycelliosDelta[] {
    this.text += delta;
    const output: MycelliosDelta[] = [];
    if (this.contentStart === undefined) {
      const start = whitespace(this.text, 0);
      const prefix = this.text.slice(start);
      if ("<think>".startsWith(prefix)) return output;
      if (prefix.startsWith("<think>")) {
        const from = start + "<think>".length;
        const end = this.text.indexOf("</think>", from);
        const safeEnd = end < 0 ? Math.max(from, this.text.length - "</think>".length + 1) : end;
        const fresh = this.text.slice(from + this.reasoningSent, safeEnd);
        if (fresh) output.push({ reasoning_content: fresh });
        this.reasoningSent += fresh.length;
        if (end < 0) return output;
        this.contentStart = end + "</think>".length;
      } else this.contentStart = 0;
    }
    if (!this.mode) {
      const start = whitespace(this.text, this.contentStart);
      const content = this.text.slice(start);
      if (OPEN.startsWith(content)) return output;
      this.mode = content.startsWith(OPEN) ? "tools" : "plain";
      this.cursor = start;
      if (this.contentStart !== 0) this.contentStart = start;
    }
    if (this.mode === "plain") {
      const fresh = this.text.slice(this.contentStart + this.plainSent);
      if (fresh) output.push({ content: fresh });
      this.plainSent += fresh.length;
      return output;
    }
    while (true) {
      this.cursor = whitespace(this.text, this.cursor);
      const rest = this.text.slice(this.cursor);
      if (OPEN.startsWith(rest)) return output;
      if (!rest.startsWith(OPEN)) throw new Error("Unexpected text after a tool call.");
      if (!this.current) {
        if (this.calls >= (this.parallel ? 32 : 1)) throw new Error("Tool call limit exceeded.");
        this.current = { id: `call_${randomUUID()}`, sent: 0, announced: false };
      }
      const jsonStart = whitespace(this.text, this.cursor + OPEN.length);
      if (jsonStart === this.text.length) return output;
      const fields = callFields(this.text, jsonStart);
      if (fields.name !== undefined && !this.allowedNames.includes(fields.name))
        throw new Error("The model requested an unavailable tool.");
      const name = fields.name && !this.current.name ? fields.name : undefined;
      const args = fields.args?.slice(this.current.sent);
      if (name || args) {
        output.push({
          tool_calls: [
            {
              index: this.calls,
              ...(!this.current.announced
                ? { id: this.current.id, type: "function" as const }
                : {}),
              function: { ...(name ? { name } : {}), ...(args ? { arguments: args } : {}) },
            },
          ],
        });
        this.current.announced = true;
        if (name) this.current.name = name;
        this.current.sent += args?.length ?? 0;
      }
      if (fields.end === undefined) return output;
      const tailStart = whitespace(this.text, fields.end);
      const tail = this.text.slice(tailStart);
      if (CLOSE.startsWith(tail)) return output;
      if (!tail.startsWith(CLOSE)) throw new Error("Incomplete tool envelope.");
      this.cursor = tailStart + CLOSE.length;
      this.calls++;
      this.current = undefined;
    }
  }
}
