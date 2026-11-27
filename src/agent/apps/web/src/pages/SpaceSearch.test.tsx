// @vitest-environment jsdom

import type { SearchHit } from "@mycellios/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));

import { SpaceSearchResults } from "./SpaceSearch";

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
  vi.restoreAllMocks();
});

function file(artifactId: string): SearchHit {
  return {
    kind: "file",
    botId: "bot-1",
    botName: "Scout",
    title: `${artifactId}.png`,
    snippet: "image/png, 10 bytes",
    messageId: "message-1",
    seq: 4,
    artifactId,
  };
}

it("renders every file sent in one message without duplicate-key errors", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () =>
    root.render(
      <SpaceSearchResults
        hits={[file("artifact-1"), file("artifact-2")]}
        loading={false}
        onSelect={() => {}}
      />,
    ),
  );
  expect(error).not.toHaveBeenCalled();
  expect(container.querySelectorAll("button")).toHaveLength(2);
});

it("names the side conversation a message hit opens", async () => {
  const hit: SearchHit = {
    kind: "message",
    botId: "bot-1",
    botName: "Scout",
    title: "Scout",
    snippet: "the launch checklist",
    messageId: "message-2",
    seq: 7,
    taskThreadId: "thread-2",
    conversationTitle: "Launch plan",
  };
  const onSelect = vi.fn();
  await act(async () => root.render(<SpaceSearchResults hits={[hit]} loading={false} onSelect={onSelect} />));
  expect(container.querySelector('[data-testid="search-hit-conversation"]')?.textContent).toBe(" · Launch plan");
  await act(async () => container.querySelector("button")!.click());
  expect(onSelect).toHaveBeenCalledWith(hit);
});

it("offers result filters and reports the chosen one", async () => {
  const onFilter = vi.fn();
  await act(async () =>
    root.render(<SpaceSearchResults hits={[]} loading={false} onSelect={() => {}} filter="all" onFilter={onFilter} />),
  );
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="search-filters"] button'));
  expect(buttons.map((button) => button.textContent)).toEqual(["All", "Messages", "Micos", "Groups", "Files", "Routines"]);
  expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
  await act(async () => buttons[1]!.click());
  expect(onFilter).toHaveBeenCalledWith("messages");
  expect(container.textContent).toContain("No results");
});

it("groups results by kind with a count, without kind labels or repeated names", async () => {
  const mico: SearchHit = { kind: "conversation", botId: "bot-1", botName: "Mico", title: "Mico", snippet: "CEO · Coordination" };
  const plain: SearchHit = { kind: "conversation", botId: "bot-2", botName: "SEO", title: "SEO", snippet: "SEO" };
  await act(async () =>
    root.render(
      <SpaceSearchResults hits={[file("ledger"), mico, plain]} loading={false} onSelect={() => {}} query="co" />,
    ),
  );
  const sections = [...container.querySelectorAll("section")];
  expect(sections.map((section) => section.getAttribute("data-testid"))).toEqual(["search-section-micos", "search-section-files"]);
  expect(sections[0]!.querySelector("h3")?.textContent).toBe("Micos2");
  const rows = [...sections[0]!.querySelectorAll("button")].map((row) => row.textContent);
  expect(rows).toEqual(["MicoCEO · Coordination", "SEO"]);
  expect(container.textContent).not.toMatch(/bconversationb|bfileb/);
  // A file names who has it, not its type and size.
  expect(sections[1]!.querySelector("button")?.textContent).toBe("ledger.pngScout");
  expect(sections[0]!.querySelector("mark")?.textContent).toBe("co");
});
