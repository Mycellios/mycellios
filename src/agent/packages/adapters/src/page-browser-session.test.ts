import { describe, expect, it } from "vitest";
import { PageBrowserSession } from "./page-browser-session.js";

function stepsPage() {
  return new PageBrowserSession(
    "https://example.test/steps",
    `<!doctype html><html><head><title>Steps</title></head><body>
      <p>Order saved</p><input aria-label="Name" /><button>Menu</button>
    </body></html>`,
  );
}

describe("in-process page session", () => {
  it("runs key, scroll, hover and wait steps", () => {
    const session = stepsPage();
    // Each snapshot names the elements anew, so both refs come from the same one.
    const { elements } = session.snapshot();
    const name = elements.find((el) => el.name === "Name")!.ref;
    const menu = elements.find((el) => el.name === "Menu")!.ref;
    expect(
      session.act([
        { kind: "press", key: "Shift+Tab", ref: name },
        { kind: "press", key: "Enter" },
        { kind: "scroll", direction: "down" },
        { kind: "hover", ref: menu },
        { kind: "wait", until: "text", text: "order   SAVED" },
        { kind: "wait", until: "gone", text: "Loading" },
        { kind: "wait", until: "url", text: "/steps" },
        { kind: "wait", until: "quiet" },
      ]),
    ).toMatchObject({ ok: true, completed: 8 });
  });

  it("settles a wait it cannot see met and a dialog answer with no dialog open", () => {
    const session = stepsPage();
    for (const [step, error] of [
      [{ kind: "wait", until: "text", text: "Never" }, "did not change as wait expected"],
      [{ kind: "wait", until: "url" }, "did not change as wait expected"],
      [{ kind: "dialog", accept: true }, "No dialog from your steps is open"],
    ] as const) {
      const result = session.act([step]);
      expect(result).toMatchObject({ ok: false, completed: 0, uncertain: false });
      expect(result.error).toContain(error);
      expect(result).not.toHaveProperty("fallback");
    }
  });

  it("lists the whole page in its first part, so there is no later part", () => {
    const session = stepsPage();
    expect(session.snapshot(0).elements.length).toBeGreaterThan(0);
    expect(session.snapshot(1)).toEqual({
      url: "https://example.test/steps",
      title: "Steps",
      tree: "",
      elements: [],
      error: "This page has 1 part(s), numbered from 0, so there is no part 1.",
    });
  });

  it("still asks for a fresh ref when a step names one it does not know", () => {
    expect(stepsPage().act([{ kind: "hover", ref: "e999" }])).toMatchObject({
      ok: false,
      completed: 0,
      fallback: "computer_act",
      error: 'Unknown element ref "e999". Call browser_snapshot and use a fresh ref.',
    });
  });
});
