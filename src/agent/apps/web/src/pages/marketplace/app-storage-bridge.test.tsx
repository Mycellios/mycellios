// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { APP_STORAGE_MESSAGE, type StorageTarget, useAppStorageBridge } from "./app-storage-bridge";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const client = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
};
function Frame({ target }: { target: StorageTarget | null }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useAppStorageBridge(ref, target, client as never);
  return <iframe ref={ref} title="app" />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  for (const fn of Object.values(client)) fn.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(target: StorageTarget | null) {
  await act(async () => root.render(<Frame target={target} />));
  const frame = host.querySelector("iframe")!.contentWindow!;
  const replies: unknown[] = [];
  vi.spyOn(frame, "postMessage").mockImplementation((message: unknown) => {
    replies.push(message);
  });
  return { frame, replies };
}
async function send(source: Window | null, data: unknown) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const message = (body: object) => ({ type: APP_STORAGE_MESSAGE, id: "r1", ...body });

it("answers the rendered app with data scoped by the host, not by the message", async () => {
  const { frame, replies } = await mount({ id: "site-a", preview: false });
  client.get.mockResolvedValue({ found: true, value: { zoom: 2 } });
  await send(frame, message({ op: "get", key: "projects/a", id: "r1" }));
  expect(client.get).toHaveBeenCalledWith({ id: "site-a", preview: false, key: "projects/a" });
  expect(replies).toEqual([
    { type: APP_STORAGE_MESSAGE, id: "r1", ok: true, found: true, value: { zoom: 2 } },
  ]);
  client.set.mockResolvedValue({ keys: 1, bytes: 10 });
  await send(frame, message({ op: "set", key: "k", value: [1, null], id: "r2" }));
  expect(client.set).toHaveBeenCalledWith({
    id: "site-a",
    preview: false,
    key: "k",
    value: [1, null],
  });
  expect(replies.at(-1)).toMatchObject({ id: "r2", ok: true, usage: { keys: 1, bytes: 10 } });
});
it("ignores other windows, malformed requests and disabled apps", async () => {
  const { frame, replies } = await mount({ id: "site-a", preview: true });
  await send(window, message({ op: "get", key: "k" }));
  await send(null, message({ op: "get", key: "k" }));
  await send(frame, message({ op: "get", key: "bad key0000" }));
  await send(frame, message({ op: "get", key: "k", siteId: "other" }));
  await send(frame, { type: "other", op: "get" });
  expect(client.get).not.toHaveBeenCalled();
  expect(replies).toEqual([]);

  const disabled = await mount(null);
  await send(disabled.frame, message({ op: "get", key: "k" }));
  expect(client.get).not.toHaveBeenCalled();
  expect(disabled.replies).toEqual([]);
});
it("reports server errors back to the app without throwing in the host", async () => {
  const { frame, replies } = await mount({ id: "site-a", preview: false });
  client.set.mockRejectedValue(new Error("Esta app ya usa sus 5 MB de datos."));
  await send(frame, message({ op: "set", key: "k", value: "x" }));
  expect(replies).toEqual([
    { type: APP_STORAGE_MESSAGE, id: "r1", ok: false, error: "Esta app ya usa sus 5 MB de datos." },
  ]);
  await send(frame, message({ op: "delete" }));
  expect(replies.at(-1)).toMatchObject({ ok: false, error: "Falta la clave." });
});
