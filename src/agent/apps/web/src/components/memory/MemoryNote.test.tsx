// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLinkResolver, type VaultNote } from "../../lib/memory-vault";
import { MemoryNote, type MemoryNoteProps } from "./MemoryNote";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

function note(id: string, path: string, content = ""): VaultNote {
  return {
    id,
    path,
    content,
    scope: "user",
    botId: null,
    revision: 1,
    updatedAt: "2026-11-27T10:00:00.000Z",
    inclusion: "searchable",
    userControlled: false,
    taskThreadId: null,
  };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const notes = [
  note("a", "a.md", "Plans live in [[trips|my trips]]; [[someday]] is missing."),
  note("b", "trips.md", "Japan"),
  note("c", "tea.md"),
];

async function render(overrides: Partial<MemoryNoteProps> = {}) {
  const props: MemoryNoteProps = {
    note: notes[0]!,
    locationLabel: "General",
    notes,
    resolve: createLinkResolver(notes),
    backlinks: [notes[2]!],
    outgoing: [notes[1]!],
    editing: false,
    draft: "",
    busy: false,
    error: null,
    conflicted: false,
    confirmingDelete: false,
    onDraft: vi.fn(),
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    onToggleEssential: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    onOpenNote: vi.fn(),
    onCreateFromLink: vi.fn(),
    ...overrides,
  };
  await act(async () => root.render(<MemoryNote {...props} />));
  return props;
}

function button(text: string) {
  const match = [...host.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!match) throw new Error(`No button ${text}`);
  return match;
}

it("opens linked notes and offers to create missing ones", async () => {
  const props = await render();
  await act(async () => button("my trips").click());
  expect(props.onOpenNote).toHaveBeenCalledWith("b");
  await act(async () => button("someday").click());
  expect(props.onCreateFromLink).toHaveBeenCalledWith("someday");
});

it("lists backlinks and outgoing links", async () => {
  const props = await render();
  expect(host.textContent).toContain("Linked from");
  await act(async () => button("tea").click());
  expect(props.onOpenNote).toHaveBeenCalledWith("c");
  expect(host.textContent).toContain("Links to");
});

it("suggests notes after [[ and completes the link", async () => {
  const onDraft = vi.fn();
  await render({ editing: true, draft: "See [[tr", onDraft });
  const field = host.querySelector("textarea")!;
  await act(async () => {
    field.focus();
    field.setSelectionRange(8, 8);
    field.click();
  });
  const option = [...host.querySelectorAll('[role="option"]')].find(
    (element) => element.textContent === "trips",
  );
  expect(option).toBeTruthy();
  await act(async () => (option as HTMLButtonElement).click());
  expect(onDraft).toHaveBeenCalledWith("See [[trips]]");
});

it("saves only changed text and keeps delete away from MEMORY.md", async () => {
  const onSave = vi.fn();
  await render({ note: note("m", "MEMORY.md", "x"), editing: true, draft: "x", onSave });
  expect(button("Save").disabled).toBe(true);
  expect(host.textContent).not.toContain("Delete");
});
