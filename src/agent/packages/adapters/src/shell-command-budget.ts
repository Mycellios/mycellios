import { sandboxCommandTimeoutMs } from "@rakazo/core";

export const SEARCH_COMMAND_TIMEOUT_MS = 45_000;
export const MAX_SEARCH_COMMAND_TIMEOUT_MS = 180_000;
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

type SearchContext = { cwd?: string; home?: string; projectPath?: string };
export type SearchBudget = { timeoutMs: number; progress?: { maxMs: number; roots: string[] }; refusal?: string };
const valueFlags = new Set(["-e", "--regexp", "-f", "--file", "-g", "--glob", "--iglob", "--include", "--exclude", "--exclude-dir", "--max-depth", "--max-count", "-m", "-A", "-B", "-C", "--after-context", "--before-context", "--context"]);
const broadFolders = /^(?:documents|desktop|downloads|appdata|library|\.git|node_modules)$/i;
const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\.\//, "");
const broad = (value: string, home?: string) => {
  const root = normalize(value).replace(/\/\*+$/, "");
  const canonical = (path: string) => normalize(path).replace(/^([a-z]):/i, "/$1").toLowerCase();
  return !root || /^(?:~|\$HOME|\$env:USERPROFILE|[a-z]:|\/[a-z]|\.\.)$/i.test(root)
    || /(?:^|\/)\.\.(?:\/|$)/.test(root)
    || (home !== undefined && canonical(root) === canonical(home));
};

/** Scope recognition is a scheduling hint, not a shell authorization boundary. */
export function planShellSearch(command: string, requested?: number, context: SearchContext = {}): SearchBudget {
  const result: SearchBudget = { timeoutMs: shellCommandTimeoutMs(command, requested) };
  const raw = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|\|\||[;|\n]|[^\s;|]+/g) ?? [];
  const segments: string[][] = [[]];
  for (const token of raw) {
    if ([";", "|", "&&", "||", "\n"].includes(token)) segments.push([]);
    else segments.at(-1)!.push(token.replace(/^['"]|['"]$/g, ""));
  }
  let cwd = context.cwd ?? context.projectPath;
  const roots: string[] = []; let adaptive = isBoundedSearchCommand(command), found = false;
  for (const [rawName, ...args] of segments) {
    const name = rawName?.replace(/^\/(?:usr\/)?bin\//, "");
    if (name === "cd") { cwd = args[0] ?? "~"; continue; }
    if (!["rg", "grep", "find"].includes(name ?? "")) {
      if (name && !["head", "tail"].includes(name)) adaptive = false;
      continue;
    }
    found = true;
    const paths: string[] = [];
    if (name === "find") {
      let index = 0;
      while (["-H", "-L", "-P", "--"].includes(args[index] ?? "")) index++;
      for (const arg of args.slice(index)) { if (/^[-!(]/.test(arg)) break; paths.push(arg); }
      if (args.includes("-L")) adaptive = false;
    } else {
      let pattern = args.includes("--files"), literal = false;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "--") { literal = true; continue; }
        if (!literal && arg.startsWith("-")) {
          if (valueFlags.has(arg)) { if (["-e", "--regexp", "-f", "--file"].includes(arg)) pattern = true; i++; }
          if (/^--(?:regexp|file)=/.test(arg)) pattern = true;
          continue;
        }
        if (!pattern) pattern = true; else paths.push(arg);
      }
    }
    for (const path of paths.length ? paths : ["."]) {
      if (broad(path, context.home) || (path === "." && cwd !== undefined && broad(cwd, context.home))) {
        result.refusal = "Choose a concrete project directory before searching. Searching the whole home, a drive root or parent tree was not started. Use a bounded project path and exclude dependencies/caches.";
        return result;
      }
      const scope = path === "." ? cwd : path;
      if (!scope || broadFolders.test(normalize(scope).split("/").at(-1) ?? "") || /(?:^|\/)\.\.(?:\/|$)|[*?{}$]/.test(scope)) adaptive = false;
      roots.push(normalize(path));
    }
  }
  if (found && adaptive) {
    const maxMs = Math.min(MAX_SEARCH_COMMAND_TIMEOUT_MS, requested && Number.isSafeInteger(requested) && requested >= 1_000 && requested <= 3_600_000 ? requested : sandboxCommandTimeoutMs());
    if (maxMs > result.timeoutMs) result.progress = { maxMs, roots: [...new Set(roots)].slice(0, 8) };
  }
  return result;
}
