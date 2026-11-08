import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const macro = /(?<![A-Za-z0-9_$.])t`([^`$]*)`/g;

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, files);
    else if (/\.(tsx|ts)$/.test(name) && !name.includes(".test.") && !name.endsWith(".d.ts"))
      files.push(path);
  }
  return files;
}

function catalogMessages(locale: string): Map<string, string> {
  const source = readFileSync(new URL(`../locales/${locale}/messages.po`, import.meta.url), "utf8");
  const messages = new Map<string, string>();
  for (const block of source.split(/\n\n+/)) {
    const id = block.match(/msgid ((?:"(?:\\.|[^"\\])*"\n?)+)/);
    const text = block.match(/msgstr ((?:"(?:\\.|[^"\\])*"\n?)+)/);
    if (!id || !text) continue;
    const decode = (value: string): string =>
      [...value.matchAll(/"((?:\\.|[^"\\])*)"/g)]
        .map((part) => JSON.parse(`"${part[1]}"`))
        .join("");
    const msgid = decode(id[1] ?? "");
    if (msgid) messages.set(msgid, decode(text[1] ?? ""));
  }
  return messages;
}

describe("English catalog", () => {
  it("contains every static interface string so a missing entry cannot render as a message id", () => {
    const english = catalogMessages("en");
    const missing: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(macro)) {
        const message = match[1] ?? "";
        if (!message.trim()) continue;
        const translation = english.get(message);
        if (!translation) missing.push(message);
      }
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});
