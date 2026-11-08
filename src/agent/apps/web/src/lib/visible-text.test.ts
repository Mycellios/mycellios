import { createHash } from "node:crypto";
import { i18n } from "@lingui/core";
import { describe, expect, it } from "vitest";
import { installVisibleText } from "./i18n";
import { visibleText } from "./visible-text";

function messageId(message: string): string {
  const hash = createHash("sha256").update(`${message}\u001f`, "utf8").digest();
  return hash
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
    .slice(0, 6);
}

const menu = ["Space settings", "Workflows", "Schedule", "Tasks"] as const;

describe("visibleText", () => {
  it("shows the English source when a catalog returns the generated message id", () => {
    for (const message of menu) {
      const id = messageId(message);
      expect(visibleText(id, { id, message })).toBe(message);
    }
    expect(messageId("Space settings")).toBe("xfK3fA");
    expect(messageId("Workflows")).toBe("woYYQq");
    expect(messageId("Schedule")).toBe("gmB6oO");
    expect(messageId("Tasks")).toBe("GtycJ_");
  });

  it("keeps a real translation", () => {
    expect(visibleText("Ajustes del espacio", { id: "xfK3fA", message: "Space settings" })).toBe(
      "Ajustes del espacio",
    );
  });
});

describe("installed translator", () => {
  it("does not render the space-switcher message ids", () => {
    installVisibleText();
    i18n.load("en", {});
    i18n.activate("en");
    for (const message of menu) {
      const id = messageId(message);
      expect(i18n._({ id, message })).toBe(message);
      expect(i18n._(id, undefined, { message })).toBe(message);
    }
    i18n.load("en", { [messageId("Routines")]: "Routines", [messageId("Usage")]: "Usage" });
    expect(i18n._({ id: messageId("Routines"), message: "Routines" })).toBe("Routines");
    expect(i18n._({ id: messageId("Usage"), message: "Usage" })).toBe("Usage");
  });
});
