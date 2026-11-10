// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const html = readFileSync(path.resolve("apps/desktop/src/setup.html"), "utf8");
const script = readFileSync(path.resolve("apps/desktop/src/setup.js"), "utf8");
const cloud = "https://www.mycellios.com/agent";

async function mount(recovery = true, manager = false) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  let onStackChange = () => {};
  const bridge = {
    platform: "win32",
    state: vi.fn(async () => ({
      manager, recovery, cloudUrl: cloud, defaultLocalUrl: "http://127.0.0.1:45173",
      saved: { mode: "new", serverUrl: "http://127.0.0.1:45173" },
      error: "private connection diagnostic",
    })),
    retry: vi.fn(async () => ({ ok: false })),
    quit: vi.fn(), save: vi.fn(async () => ({ ok: true })), test: vi.fn(),
    stack: {
      state: vi.fn(async () => ({ phase: "idle", output: [] })),
      start: vi.fn(), onChange: vi.fn((listener: () => void) => { onStackChange = listener; }),
    },
  };
  Object.assign(window, { rakazoSetup: bridge });
  new Function(script)();
  await vi.waitFor(() => expect((document.querySelector("#continue") as HTMLButtonElement).disabled).toBe(false));
  return { bridge, push: () => onStackChange() };
}

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

it("keeps ordinary recovery simple and never attaches a local stack", async () => {
  const { bridge, push } = await mount();
  expect((document.querySelector("#recovery") as HTMLElement).hidden).toBe(false);
  expect((document.querySelector("#advanced") as HTMLDetailsElement).open).toBe(false);
  expect(document.querySelector("#status")?.textContent).toBe("");
  expect(document.querySelector("#recovery-diagnostic")?.textContent).toBe("private connection diagnostic");
  expect(document.querySelector("#recovery-message")?.textContent).toBe("We couldn't connect to Mycellios.");
  push();
  expect(bridge.stack.state).not.toHaveBeenCalled();
  expect(bridge.stack.start).not.toHaveBeenCalled();
  expect(bridge.save).not.toHaveBeenCalled();
});

it("serializes user retries without supplying or saving a server", async () => {
  const { bridge } = await mount();
  let finish!: (result: { ok: boolean }) => void;
  bridge.retry.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const retry = document.querySelector("#retry") as HTMLButtonElement;
  retry.click(); retry.dispatchEvent(new MouseEvent("click"));
  expect(bridge.retry).toHaveBeenCalledExactlyOnceWith();
  expect(retry.disabled).toBe(true);
  finish({ ok: false });
  await vi.waitFor(() => expect(retry.disabled).toBe(false));
  expect(retry.textContent).toBe("Retry");
  expect(bridge.save).not.toHaveBeenCalled();
  expect(bridge.stack.start).not.toHaveBeenCalled();
});

it("refreshes the folded diagnostic after an unsuccessful retry", async () => {
  const { bridge } = await mount();
  bridge.state.mockResolvedValue({ recovery: true, cloudUrl: cloud,
    defaultLocalUrl: "http://127.0.0.1:45173", saved: null as any,
    error: "The server page did not become ready." });
  (document.querySelector("#retry") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("#recovery-diagnostic")?.textContent)
    .toBe("The server page did not become ready."));
  expect((document.querySelector("#advanced") as HTMLDetailsElement).open).toBe(false);
  expect(bridge.save).not.toHaveBeenCalled();
});

it("closes from recovery without requiring a connection", async () => {
  const { bridge } = await mount();
  (document.querySelector("#close") as HTMLButtonElement).click();
  expect(bridge.quit).toHaveBeenCalledOnce();
  expect(bridge.retry).not.toHaveBeenCalled();
});

it("keeps explicit server configuration in Advanced", async () => {
  const { bridge } = await mount(false);
  expect((document.querySelector("#advanced") as HTMLDetailsElement).open).toBe(true);
  expect((document.querySelector("#recovery") as HTMLElement).hidden).toBe(true);
  expect((document.querySelector("#mode-new") as HTMLInputElement).checked).toBe(true);
  expect(document.querySelector("#status")?.textContent).toBe("private connection diagnostic");
  expect(bridge.stack.start).not.toHaveBeenCalled();
});

it("keeps connected-server management simple without changing first-run recovery", async () => {
 await mount(false, true);
 expect(document.querySelector("#heading")?.textContent).toBe("Servidores");
 expect(document.querySelector("fieldset")?.hidden).toBe(true);
 expect(document.querySelector("#check")?.textContent).toBe("Comprobar conexión");
 expect((document.querySelector("#server-name") as HTMLInputElement).maxLength).toBe(80);
});
