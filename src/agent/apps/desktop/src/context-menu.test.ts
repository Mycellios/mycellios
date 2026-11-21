import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ clipboard: { writeText: vi.fn() }, Menu: { buildFromTemplate: vi.fn() } }));
const { contextMenuTemplate } = await import("./context-menu.js");

const base = {
  x: 10, y: 20, mediaType: "none" as const, hasImageContents: false, linkURL: "", selectionText: "", isEditable: false,
  editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canDelete: false, canSelectAll: true, canEditRichly: false },
};
const actions = () => ({ copyImage: vi.fn(), copyText: vi.fn() });

it("copies the right-clicked image at its position", () => {
  const spy = actions();
  const menu = contextMenuTemplate({ ...base, mediaType: "image", hasImageContents: true }, spy, "es-ES");
  expect(menu.map(item => item.label)).toEqual(["Copiar imagen"]);
  (menu[0]!.click as () => void)();
  expect(spy.copyImage).toHaveBeenCalledWith(10, 20);
});

it("offers web links, selected text and editing actions, separated", () => {
  const spy = actions();
  const menu = contextMenuTemplate({ ...base, linkURL: "https://example.test/a", selectionText: "hello" }, spy);
  expect(menu.map(item => item.label ?? item.type)).toEqual(["Copy link", "separator", "Copy"]);
  (menu[0]!.click as () => void)();
  expect(spy.copyText).toHaveBeenCalledWith("https://example.test/a");
  const field = contextMenuTemplate({ ...base, isEditable: true }, spy);
  expect(field.map(item => [item.role, item.enabled])).toEqual([["cut", false], ["copy", false], ["paste", true], ["selectAll", true]]);
});

it("shows nothing for plain content or non-web links", () => {
  expect(contextMenuTemplate(base, actions())).toEqual([]);
  expect(contextMenuTemplate({ ...base, linkURL: "javascript:alert(1)", selectionText: "  " }, actions())).toEqual([]);
  expect(contextMenuTemplate({ ...base, mediaType: "image", hasImageContents: false }, actions())).toEqual([]);
});
