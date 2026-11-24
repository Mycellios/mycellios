// @vitest-environment jsdom
import type { Bot, Group } from "@mycellios/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GroupFolders } from "./GroupFolders";

const state = vi.hoisted(() => ({
  bridge: undefined as undefined | { computer: Record<string, ReturnType<typeof vi.fn>> },
}));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => state.bridge }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@mycellios/ui-web", () => ({
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
}));

const SITE = "a".repeat(64);
const NOTES = "b".repeat(64);
const members: Group["members"] = [
  { botId: "ana", name: "Ana", color: "green" },
  { botId: "ben", name: "Ben", color: "blue" },
];
const bots = [
  { id: "ana", computerMode: "dedicated" },
  { id: "ben", computerMode: "isolated" },
] as Bot[];
const folders = vi.fn();
const addFolder = vi.fn();
const removeFolder = vi.fn();
const rpc = { groups: { folders, addFolder, removeFolder } } as never;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.bridge = undefined;
  folders.mockResolvedValue({
    spaceId: "space",
    folders: [
      { folderId: SITE, name: "site", label: "site", createdAt: "2026-11-24T00:00:00.000Z" },
    ],
  });
  addFolder.mockResolvedValue({
    folderId: NOTES,
    name: "notes",
    label: "notes",
    createdAt: "2026-11-24T00:00:00.000Z",
  });
  removeFolder.mockResolvedValue({ ok: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(<GroupFolders groupId="group-1" members={members} bots={bots} rpc={rpc} />);
  });
}
const button = (name: string) =>
  [...host.querySelectorAll("button")].find(
    (item) => item.textContent === name || item.getAttribute("aria-label") === name,
  );

it("lists the group's folders on the web and says who can use them, without offering a picker", async () => {
  await render();
  expect(folders).toHaveBeenCalledWith({ groupId: "group-1" });
  expect(host.textContent).toContain("site");
  expect(host.textContent).toContain("1/8");
  expect(host.textContent).toContain("Add folders from Mycellios Desktop.");
  expect(host.textContent).toContain("Can use them: Ana");
  expect(host.textContent).toContain("Can't reach them (not on This PC): Ben");
  expect(button("Add folder")).toBeUndefined();
  expect(button("Connect")).toBeUndefined();
  await act(async () => button("Remove site")!.click());
  expect(removeFolder).toHaveBeenCalledWith({ groupId: "group-1", folderId: SITE });
});

it("adds a folder chosen with the Desktop picker and withdraws the grant if the server refuses it", async () => {
  const computer = {
    requestAccess: vi.fn().mockResolvedValue(true),
    chooseGroupFolder: vi
      .fn()
      .mockResolvedValue({ folderId: NOTES, name: "notes", path: "C:\\notes" }),
    groupFolders: vi.fn().mockResolvedValue([{ folderId: SITE, name: "site", path: "C:\\site" }]),
    removeGroupFolder: vi.fn().mockResolvedValue(undefined),
  };
  state.bridge = { computer };
  await render();
  expect(button("Connect")).toBeUndefined();
  await act(async () => button("Add folder")!.click());
  expect(computer.chooseGroupFolder).toHaveBeenCalledWith("group-1", undefined);
  expect(addFolder).toHaveBeenCalledWith({ groupId: "group-1", folderId: NOTES, name: "notes" });
  expect(computer.removeGroupFolder).not.toHaveBeenCalled();

  addFolder.mockRejectedValueOnce(new Error("A group can have up to 8 folders."));
  await act(async () => button("Add folder")!.click());
  expect(computer.removeGroupFolder).toHaveBeenCalledWith("group-1", NOTES);
  expect(host.querySelector("[role=alert]")?.textContent).toContain("up to 8");
});

it("offers Connect for a folder this PC does not grant, and removes the PC grant with the folder", async () => {
  const computer = {
    requestAccess: vi.fn().mockResolvedValue(true),
    chooseGroupFolder: vi
      .fn()
      .mockResolvedValue({ folderId: SITE, name: "site", path: "C:\\site" }),
    groupFolders: vi.fn().mockResolvedValue([]),
    removeGroupFolder: vi.fn().mockResolvedValue(undefined),
  };
  state.bridge = { computer };
  await render();
  expect(host.textContent).toContain("Not connected on this PC");
  await act(async () => button("Connect")!.click());
  expect(computer.chooseGroupFolder).toHaveBeenCalledWith("group-1", SITE);
  await act(async () => button("Remove site")!.click());
  expect(removeFolder).toHaveBeenCalledWith({ groupId: "group-1", folderId: SITE });
  expect(computer.removeGroupFolder).toHaveBeenCalledWith("group-1", SITE);
});

it("does not ask the picker when the person declines PC access, and stops adding at eight", async () => {
  const computer = {
    requestAccess: vi.fn().mockResolvedValue(false),
    chooseGroupFolder: vi.fn(),
    groupFolders: vi.fn().mockResolvedValue([]),
    removeGroupFolder: vi.fn(),
  };
  state.bridge = { computer };
  await render();
  await act(async () => button("Add folder")!.click());
  expect(computer.chooseGroupFolder).not.toHaveBeenCalled();
  folders.mockResolvedValue({
    spaceId: "space",
    folders: Array.from({ length: 8 }, (_, index) => ({
      folderId: String(index).repeat(64),
      name: `f${index}`,
      label: `f${index}`,
      createdAt: "2026-11-24T00:00:00.000Z",
    })),
  });
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(button("Add folder")?.disabled).toBe(true);
});
