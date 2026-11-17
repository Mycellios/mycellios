import { sandboxCommandTimeoutMs } from "@rakazo/core";

export const SEARCH_COMMAND_TIMEOUT_MS = 45_000;
const readCommands = new Set(["cd", "pwd", "echo", "printf", "find", "grep", "rg", "ls", "head", "tail", "wc", "sort", "cut"]);

/** A conservative deadline hint, never an authorization or a claim that shell is safe. */
export function isBoundedSearchCommand(command: string): boolean {
  if (command.length > 64_000 || /[`$]|[<>](?!\/dev\/null)/.test(command.replace(/\d*>\/dev\/null/g, ""))) return false;
  const tokens = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|\|\||[;|\n]|[^\s;|]+/g) ?? [];
  let start = true, search = false, program = "";
  for (const token of tokens) {
    if ([";", "|", "&&", "||", "\n"].includes(token)) { start = true; continue; }
    if (start) {
      const name = token.replace(/^['"]|['"]$/g, "").replace(/^\/(?:usr\/)?bin\//, "");
      if (!readCommands.has(name)) return false;
      program = name;
      search ||= ["find", "grep", "rg"].includes(name); start = false;
    } else if (/^(?:-exec(?:dir)?|-ok(?:dir)?|-delete|-fprint0?|-fprintf)$/.test(token) || /^(?:--pre|--output)(?:=|$)/.test(token) || (program === "sort" && token === "-o")) return false;
  }
  return search;
}

export function shellCommandTimeoutMs(command: string, requested?: number): number {
  const budget = typeof requested === "number" && Number.isSafeInteger(requested) && requested >= 1_000 && requested <= 3_600_000
    ? requested : sandboxCommandTimeoutMs();
  return isBoundedSearchCommand(command) ? Math.min(budget, SEARCH_COMMAND_TIMEOUT_MS) : budget;
}
