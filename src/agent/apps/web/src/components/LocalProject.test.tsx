// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../lib/rpc";
import { LocalProject } from "./LocalProject";

const { computer } = vi.hoisted(() => ({ computer: {
  projectAvailable: vi.fn(), project: vi.fn(), requestAccess: vi.fn(), chooseProject: vi.fn(),
} }));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => ({ computer }) }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: string }) => children,
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));

const documents = { name: "Documents", path: "C:\\Documents" };
const repository = { name: "Example", path: "C:\\Example", repositoryId: "11111111-1111-4111-8111-111111111111" };
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const saveProject = vi.fn(), open = vi.fn(), onTask = vi.fn();
const rpc = { development: { saveProject, open } } as unknown as RpcClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  computer.projectAvailable.mockResolvedValue(true);
  computer.project.mockResolvedValue(null);
  computer.requestAccess.mockResolvedValue(true);
  computer.chooseProject.mockResolvedValue(documents);
  saveProject.mockResolvedValue({ id: repository.repositoryId });
  open.mockResolvedValue({ threadId: "branch-chat" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(() => root.render(<LocalProject botId="mico" rpc={rpc} onTask={onTask} />));
const button = (name: string) => [...document.querySelectorAll("button")].find(element => element.textContent === name)!;
const show = () => act(() => host.querySelector("button")!.click());

it("stays hidden when the native picker is unavailable", async () => {
  computer.projectAvailable.mockResolvedValue(false);
  await render();
  expect(host.querySelector("button")).toBeNull();
  expect(computer.project).not.toHaveBeenCalled();
});

it("opens a normal folder for this Mico without creating a project or sending a message", async () => {
  await render();
  await show();
  await act(() => button("Add folder").click());
  expect(computer.requestAccess).toHaveBeenCalledOnce();
  expect(computer.chooseProject).toHaveBeenCalledWith("mico");
  expect(document.body.textContent).toContain("Documents");
  expect(button("New task in a branch")).toBeUndefined();
  expect(saveProject).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("does not open the picker when local access is denied", async () => {
  computer.requestAccess.mockResolvedValue(false);
  await render();
  await show();
  await act(() => button("Add folder").click());
  expect(computer.chooseProject).not.toHaveBeenCalled();
});

it("opens a branch task on the same Mico using an opaque repository ID", async () => {
  computer.project.mockResolvedValue(repository);
  await render();
  await show();
  await act(() => button("New task in a branch").click());
  const input = document.querySelector<HTMLInputElement>("input")!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Improve login");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveProject).toHaveBeenCalledWith({ id: repository.repositoryId, name: "Example" });
  expect(open).toHaveBeenCalledWith({ botId: "mico", title: "Improve login", projectKey: `project:${repository.repositoryId}`,
    taskKey: expect.stringMatching(/^project-task:/) });
  expect(onTask).toHaveBeenCalledWith("branch-chat");
  expect(computer.chooseProject).not.toHaveBeenCalled();
});
