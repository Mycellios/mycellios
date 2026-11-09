/**
 * Exact-match file editing, matching the tool Claude Code (and therefore
 * OpenBot) gives its agent. A small change must not require reading and
 * rewriting a whole file: the model quotes the block it already saw and the
 * server applies only that replacement.
 */

export type FileEditResult =
  | { ok: true; content: string; replacements: number }
  | { ok: false; error: string; replacements: 0 };

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Apply one exact replacement, refusing ambiguous or no-op edits. */
export function applyFileEdit(input: {
  content: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}): FileEditResult {
  if (!input.oldString) {
    return { ok: false, error: "old_string must not be empty", replacements: 0 };
  }
  if (input.oldString === input.newString) {
    return { ok: false, error: "old_string and new_string are identical", replacements: 0 };
  }
  let oldString = input.oldString;
  let newString = input.newString;
  let matches = countOccurrences(input.content, oldString);
  // Models write LF even when the file uses CRLF. Retry with the file's own
  // line endings before reporting a missed match, and keep them on write.
  if (
    matches === 0 &&
    input.content.includes("\r\n") &&
    oldString.includes("\n") &&
    !oldString.includes("\r\n")
  ) {
    const crlfOld = oldString.replace(/\r?\n/g, "\r\n");
    const crlfMatches = countOccurrences(input.content, crlfOld);
    if (crlfMatches > 0) {
      oldString = crlfOld;
      newString = newString.replace(/\r?\n/g, "\r\n");
      matches = crlfMatches;
    }
  }
  if (matches === 0) {
    return { ok: false, error: "old_string was not found in this file", replacements: 0 };
  }
  if (matches > 1 && !input.replaceAll) {
    return {
      ok: false,
      error: `old_string appears ${matches} times; include more surrounding text or set replace_all`,
      replacements: 0,
    };
  }
  const next = input.replaceAll
    ? input.content.split(oldString).join(newString)
    : (() => {
        const index = input.content.indexOf(oldString);
        return (
          input.content.slice(0, index) +
          newString +
          input.content.slice(index + oldString.length)
        );
      })();
  if (next === input.content) {
    return { ok: false, error: "the edit produced no change", replacements: 0 };
  }
  return { ok: true, content: next, replacements: input.replaceAll ? matches : 1 };
}

export type FileSlice = {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
};

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/** One-based window over a text file, like Read's offset/limit. */
export function sliceFileContent(
  content: string,
  offset?: unknown,
  limit?: unknown,
  maxLines = 2_000,
): FileSlice {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const start = Math.min(positiveInteger(offset) ?? 1, Math.max(totalLines, 1));
  const count = Math.min(positiveInteger(limit) ?? maxLines, maxLines);
  const end = Math.min(start + count - 1, totalLines);
  return {
    content: lines.slice(start - 1, end).join("\n"),
    startLine: start,
    endLine: end,
    totalLines,
    truncated: end < totalLines,
  };
}
