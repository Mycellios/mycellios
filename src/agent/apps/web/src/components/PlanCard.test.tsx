// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
}));
vi.mock("@rakazo/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../lib/rpc", () => ({ rpc: {} }));

import type { AskBlock } from "./AskCard";
import { AskCard } from "./AskCard";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const card = (extra: Partial<AskBlock> = {}): AskBlock => ({
  kind: "ask",
  text: "On it: fixing the 502 on staging.",
  status: "pending",
  actions: [{ id: "start", label: "Start" }, { id: "alternative", label: "Only diagnose" }, { id: "cancel", label: "Cancel" }],
  plan: { steps: [{ label: "First", text: "Read the proxy logs" }], autoStartAt: new Date(Date.now() + 8_000).toISOString() },
  ...extra,
});

it("shows the plan with Start, the alternative and Cancel, and answers with the chosen id", async () => {
  const onAnswer = vi.fn(async () => undefined);
  await act(async () => root.render(<AskCard block={card()} canAnswer canDismiss={false} onAnswer={onAnswer} onDismiss={vi.fn()} />));
  expect(container.querySelector('[data-testid="plan-card"]')?.textContent).toContain("Read the proxy logs");
  const buttons = [...container.querySelectorAll("button")].map((button) => button.textContent);
  expect(buttons[0]).toMatch(/^Start · \d s$/);
  expect(buttons.slice(1)).toEqual(["Only diagnose", "Cancel"]);
  await act(async () => [...container.querySelectorAll("button")][1]!.click());
  expect(onAnswer).toHaveBeenCalledWith("alternative", undefined);
});

it("says when the plan started because nobody answered", async () => {
  await act(async () =>
    root.render(<AskCard block={card({ status: "answered", answer: "start", plan: { steps: [{ label: "First", text: "Look" }], autoStarted: true } })} canAnswer canDismiss={false} onAnswer={vi.fn()} onDismiss={vi.fn()} />),
  );
  expect(container.querySelector('[data-testid="plan-card-outcome"]')?.textContent).toBe("Started (nobody answered in time)");
  expect(container.querySelectorAll("button")).toHaveLength(0);
});
