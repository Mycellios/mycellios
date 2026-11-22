import { describe, expect, it } from "vitest";
import {
  automaticThreadTitle,
  boundThreadError,
  countsForThreadLifecycle,
  deriveThreadState,
  parseThreadTitle,
  THREAD_TITLE_INVALID_ERROR,
  threadOutcomeForRun,
  threadStartedByForKind,
} from "./thread-lifecycle.js";

describe("automaticThreadTitle", () => {
  it("names a conversation after the first line that has text", () => {
    expect(automaticThreadTitle([{ kind: "text", text: "\n  \n  Preparar   mi\tpresupuesto \nSegunda línea" }]))
      .toBe("Preparar mi presupuesto");
    expect(automaticThreadTitle([{ kind: "text", text: "Uno\r\nDos" }])).toBe("Uno");
  });

  it("cuts long titles to 120 characters ending in an ellipsis, counting whole characters", () => {
    const title = automaticThreadTitle([{ kind: "text", text: "🍄".repeat(200) }])!;
    expect(Array.from(title)).toHaveLength(120);
    expect(title.endsWith("…")).toBe(true);
    expect(automaticThreadTitle([{ kind: "text", text: "a".repeat(120) }])).toBe("a".repeat(120));
  });

  it("falls back to the first attachment name and strips control characters", () => {
    expect(
      automaticThreadTitle([
        { kind: "text", text: "  \n " },
        { kind: "image", artifactId: "i", mimeType: "image/png", name: "Foto\u0007.png" },
        { kind: "file", artifactId: "f", mimeType: "application/pdf", name: "Presupuesto.pdf", size: 3 },
      ]),
    ).toBe("Foto .png");
    expect(automaticThreadTitle([{ kind: "file", artifactId: "f", mimeType: "text/plain", name: "", size: 1 }])).toBeNull();
    expect(automaticThreadTitle([])).toBeNull();
  });
});

describe("parseThreadTitle", () => {
  it("accepts a trimmed title of 1 to 120 characters", () => {
    expect(parseThreadTitle("  Presupuesto 2027 ")).toEqual({ ok: true, title: "Presupuesto 2027" });
    expect(parseThreadTitle("🍄".repeat(120))).toEqual({ ok: true, title: "🍄".repeat(120) });
  });

  it.each(["", "   ", "x".repeat(121), "Dos\nlíneas", "Tab\there", "Bell\u0007", "C1\u0085"])(
    "refuses %j with a clear message",
    (input) => {
      expect(parseThreadTitle(input)).toEqual({ ok: false, error: THREAD_TITLE_INVALID_ERROR });
    },
  );
});

describe("thread lifecycle helpers", () => {
  it("maps server-made identities to who opened the thread", () => {
    expect(threadStartedByForKind("conversation")).toBe("user");
    expect(threadStartedByForKind("project")).toBe("user");
    expect(threadStartedByForKind("other")).toBe("user");
    expect(threadStartedByForKind("routine")).toBe("routine");
    expect(threadStartedByForKind("workflow")).toBe("routine");
    expect(threadStartedByForKind("delegation")).toBe("delegation");
  });

  it("maps finished runs to turn outcomes", () => {
    expect(threadOutcomeForRun("completed")).toBe("completed");
    expect(threadOutcomeForRun("failed")).toBe("failed");
    expect(threadOutcomeForRun("cancelled")).toBe("interrupted");
    expect(threadOutcomeForRun("running")).toBeNull();
  });

  it("bounds stored errors to 2000 characters and drops empty ones", () => {
    expect(boundThreadError("x".repeat(2500))).toHaveLength(2000);
    expect(boundThreadError("  ")).toBeNull();
    expect(boundThreadError(null)).toBeNull();
    expect(boundThreadError("Provider refused")).toBe("Provider refused");
  });

  it("leaves background work out of a conversation's lifecycle", () => {
    expect(countsForThreadLifecycle("user")).toBe(true);
    expect(countsForThreadLifecycle(null)).toBe(true);
    expect(countsForThreadLifecycle("tickets")).toBe(false);
    expect(countsForThreadLifecycle("project_prepare")).toBe(false);
  });

  it("derives the live state from archive, deletion and active runs", () => {
    expect(deriveThreadState({ archivedAt: new Date(), activeRunStatuses: ["running"] })).toBe("closed");
    expect(deriveThreadState({ deleteAfter: "2026-11-22T00:00:00Z", activeRunStatuses: [] })).toBe("closed");
    expect(deriveThreadState({ activeRunStatuses: ["queued", "waiting_input", "running"] })).toBe("waiting");
    expect(deriveThreadState({ activeRunStatuses: ["queued", "leased"] })).toBe("running");
    expect(deriveThreadState({ activeRunStatuses: ["queued"] })).toBe("queued");
    expect(deriveThreadState({ activeRunStatuses: ["completed", "failed"] })).toBe("idle");
    expect(deriveThreadState({ activeRunStatuses: [] })).toBe("idle");
  });
});
