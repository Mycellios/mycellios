import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UI_LOCALES } from "../lib/ui-locale";
import { type LaunchMessage, launchText } from "./launch-copy";

const MESSAGES: Record<LaunchMessage, string> = {
  loading: "Loading…",
  signingIn: "Signing in…",
  slow: "This is taking a while.",
  retry: "Retry",
};

function catalog(locale: string, message: string): string | undefined {
  const source = readFileSync(
    fileURLToPath(new URL(`../locales/${locale}/messages.po`, import.meta.url)),
    "utf8",
  );
  const entry = source
    .split("\n\n")
    .find((block) => block.includes(`msgid ${JSON.stringify(message)}\n`));
  const translated = entry?.split("msgstr ")[1];
  if (!translated?.startsWith('"')) return undefined;
  return JSON.parse(translated.split("\n")[0] ?? "null") as string;
}

describe("sign-in transition copy", () => {
  it("matches the Lingui catalog in every supported language", () => {
    for (const locale of UI_LOCALES) {
      for (const message of Object.keys(MESSAGES) as LaunchMessage[]) {
        expect(launchText(locale, message), `${locale} ${message}`).toBe(
          catalog(locale, MESSAGES[message]),
        );
      }
    }
  });

  it("keeps the Spanish sign-in line", () => {
    expect(launchText("es", "signingIn")).toBe("Entrando…");
    expect(launchText("es", "slow")).toBe("Está tardando un poco.");
    expect(launchText("es", "retry")).toBe("Reintentar");
  });
});
