import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

function catalog(locale: string) {
  const source = readFileSync(new URL(`./${locale}/messages.po`, import.meta.url), "utf8");
  return new Map([...source.matchAll(/^msgid ("[^\r\n]*")\r?\nmsgstr ("[^\r\n]*")/gm)].map(match => [JSON.parse(match[1]), JSON.parse(match[2])]));
}

it.each([
  ["en", "Credits", "New Mico", "Get Mycellios Desktop"],
  ["es", "Créditos", "Nuevo Mico", "Descargar Mycellios Desktop"],
])("provides real %s catalog entries instead of displaying opaque message IDs", (locale, credits, mico, download) => {
  const messages = catalog(locale);
  expect(messages.get("Credits")).toBe(credits);
  expect(messages.get("New bot")).toBe(mico);
  expect(messages.get("Get Mycellios Desktop")).toBe(download);
  expect(messages.get("Adding 10 USD gives you 10 credits. Spore is a separate token.")).toContain("10");
});
