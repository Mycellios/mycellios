import { createHash } from "node:crypto";
import {
  BROWSER_GROUP_COLORS,
  BROWSER_MICO_NAME_MAX,
  type BrowserMico,
} from "../../../../contracts/browser-tabs-bridge.js";

/**
 * How a Mico shows itself in the person's Chrome (specs/agent-chrome-tabs): the name on its tab
 * group and the glow of the page it works in, and a group color that stays the same for the same
 * Mico. The name is cleaned here and again in the extension: it is shown next to the person's own
 * tabs, so it carries no control characters or markup and stays short.
 */
export function chromeMico(botId: string, name: string): BrowserMico {
  // Cc: control characters. Cf: invisible format characters (zero-width and direction marks).
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}<>&"'`]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  // The contract bounds UTF-16 length, so cut by whole characters until the limit.
  let cut = "";
  for (const char of cleaned) {
    if (cut.length + char.length > BROWSER_MICO_NAME_MAX) break;
    cut += char;
  }
  const shown = cut.trim() || "Mico";
  const color =
    BROWSER_GROUP_COLORS[
      createHash("sha256").update(botId).digest()[0]! % BROWSER_GROUP_COLORS.length
    ]!;
  return { name: shown, color };
}
