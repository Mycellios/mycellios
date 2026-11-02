// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { computer, add } = vi.hoisted(() => ({
  computer: {
    projectAvailable: vi.fn(),
    project: vi.fn(),
    chooseProject: vi.fn(),
    requestAccess: vi.fn(),
    connect: vi.fn(),
    connected: vi.fn(),
  },
  add: vi.fn(),
}));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => ({ computer }) }));
vi.mock("../lib/review-workspace", () => ({ useReviewWorkspace: () => ({ add }) }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));

import { LocalProject } from "./LocalProject";

vi.mock("../lib/rpc", () => ({ rpc: { bots: { setComputer: vi.fn(async () => {}) } } }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  computer.projectAvailable.mockResolvedValue(true);
  computer.project.mockResolvedValue(null);
  computer.requestAccess.mockResolvedValue(true);
  computer.connect.mockResolvedValue(undefined);
  computer.connected.mockResolvedValue(false);
  computer.chooseProject.mockResolvedValue({ name: "Example", path: "C:\\Example" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("stays hidden for hosted and browser sessions", async () => {
  computer.projectAvailable.mockResolvedValue(false);
  await act(async () => root.render(<LocalProject botId="bot" onOpened={async () => {}} />));
  expect(host.textContent).toBe("");
  expect(computer.project).not.toHaveBeenCalled();
});
it("selects natively and assigns the agent's dedicated computer before showing the project", async () => {
  const opened = vi.fn(async () => {});
  await act(async () => root.render(<LocalProject botId="bot" onOpened={opened} />));
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Open project")!
      .click(),
  );
  expect(computer.chooseProject).toHaveBeenCalledWith("bot");
  expect(opened).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Example");
});
it("does not select or modify settings after local access is denied", async () => {
  computer.requestAccess.mockResolvedValue(false);
  const opened = vi.fn();
  await act(async () => root.render(<LocalProject botId="bot" onOpened={opened} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(computer.chooseProject).not.toHaveBeenCalled();
  expect(opened).not.toHaveBeenCalled();
  expect(computer.connect).not.toHaveBeenCalled();
});
it("connects the owned native computer without opening a folder chooser", async () => {
  const opened = vi.fn(async () => {});
  await act(async () => root.render(<LocalProject botId="bot" onOpened={opened} />));
  expect(host.querySelector("details")!.open).toBe(false);
  computer.connected.mockResolvedValue(true);
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(computer.connect).toHaveBeenCalledWith("bot");
  expect(computer.chooseProject).not.toHaveBeenCalled();
  expect(opened).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="status"]')!.textContent).toBe("Connected");
});
it("never reports connected when binding or dedicated assignment fails", async () => {
  computer.connect.mockRejectedValue(new Error("Desktop disconnected"));
  const opened = vi.fn();
  await act(async () => root.render(<LocalProject botId="bot" onOpened={opened} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(opened).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("Desktop disconnected");
});
it("retains folder selection for older native releases", async () => {
  const connect = computer.connect,
    connected = computer.connected;
  Object.assign(computer, { connect: undefined, connected: undefined });
  try {
    await act(async () => root.render(<LocalProject botId="bot" onOpened={async () => {}} />));
    expect(host.textContent).not.toContain("Use this computer");
    expect(host.querySelector("details")!.open).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(computer.chooseProject).toHaveBeenCalledWith("bot");
  } finally {
    Object.assign(computer, { connect, connected });
  }
});
it("opens a loopback preview in the existing side panel, without sending a chat message", async () => {
  computer.project.mockResolvedValue({ name: "Example", path: "C:\\Example" });
  await act(async () => root.render(<LocalProject botId="bot" onOpened={async () => {}} />));
  const input = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "http://127.0.0.1:4321",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(add).toHaveBeenCalledWith({
    id: "project:bot",
    name: "Example",
    mimeType: "text/html",
    url: "http://127.0.0.1:4321/",
  });
});
