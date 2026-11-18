// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { APP_STORAGE_MESSAGE, type StorageTarget, useAppStorageBridge } from "./app-storage-bridge";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const data = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), list: vi.fn() };
const files = { put: vi.fn(), get: vi.fn(), delete: vi.fn(), list: vi.fn() };
function Frame({ target }: { target: StorageTarget | null }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useAppStorageBridge(ref, target, { data, files } as never);
  return <iframe ref={ref} title="app" />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  for (const fn of [...Object.values(data), ...Object.values(files)]) fn.mockReset();
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
  const transfers: unknown[] = [];
  vi.spyOn(frame, "postMessage").mockImplementation(((
    message: unknown,
    _origin: string,
    transfer?: unknown[],
  ) => {
    replies.push(message);
    transfers.push(transfer ?? []);
  }) as never);
  return { frame, replies, transfers };
}
async function send(source: Window | null, body: unknown) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data: body, source }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const message = (body: object) => ({ type: APP_STORAGE_MESSAGE, id: "r1", ...body });
const site = (grants: Partial<StorageTarget> = {}): StorageTarget => ({
  id: "site-a",
  preview: false,
  storage: true,
  files: false,
  ...grants,
});

it("answers the rendered app with data scoped by the host, not by the message", async () => {
  const { frame, replies } = await mount(site());
  data.get.mockResolvedValue({ found: true, value: { zoom: 2 } });
  await send(frame, message({ op: "get", key: "projects/a" }));
  expect(data.get).toHaveBeenCalledWith({ id: "site-a", preview: false, key: "projects/a" });
  expect(replies).toEqual([
    { type: APP_STORAGE_MESSAGE, id: "r1", ok: true, found: true, value: { zoom: 2 } },
  ]);
  data.set.mockResolvedValue({ keys: 1, bytes: 10 });
  await send(frame, message({ op: "set", key: "k", value: [1, null], id: "r2" }));
  expect(data.set).toHaveBeenCalledWith({
    id: "site-a",
    preview: false,
    key: "k",
    value: [1, null],
  });
  expect(replies.at(-1)).toMatchObject({ id: "r2", ok: true, usage: { keys: 1, bytes: 10 } });
});
it("ignores other windows, malformed requests and apps without grants", async () => {
  const { frame, replies } = await mount(site({ preview: true }));
  await send(window, message({ op: "get", key: "k" }));
  await send(null, message({ op: "get", key: "k" }));
  await send(frame, message({ op: "get", key: "bad key" }));
  await send(frame, message({ op: "get", key: "k", siteId: "other" }));
  await send(frame, message({ op: "delete" }));
  await send(frame, { type: "other", op: "get" });
  expect(data.get).not.toHaveBeenCalled();
  expect(replies).toEqual([]);

  const disabled = await mount(site({ storage: false, files: false }));
  await send(disabled.frame, message({ op: "get", key: "k" }));
  expect(data.get).not.toHaveBeenCalled();
  expect(disabled.replies).toEqual([]);
});
it("reports server errors back to the app without throwing in the host", async () => {
  const { frame, replies } = await mount(site());
  data.set.mockRejectedValue(new Error("Esta app ya usa sus 5 MB de datos."));
  await send(frame, message({ op: "set", key: "k", value: "x" }));
  expect(replies).toEqual([
    { type: APP_STORAGE_MESSAGE, id: "r1", ok: false, error: "Esta app ya usa sus 5 MB de datos." },
  ]);
});
it("keeps each grant separate: files need the files grant and vice versa", async () => {
  const dataOnly = await mount(site());
  await send(dataOnly.frame, message({ op: "file.list" }));
  expect(files.list).not.toHaveBeenCalled();
  expect(dataOnly.replies).toEqual([
    { type: APP_STORAGE_MESSAGE, id: "r1", ok: false, error: "Esta app no tiene ese permiso." },
  ]);
  const filesOnly = await mount(site({ storage: false, files: true }));
  await send(filesOnly.frame, message({ op: "get", key: "k" }));
  expect(data.get).not.toHaveBeenCalled();
  expect(filesOnly.replies.at(-1)).toMatchObject({
    ok: false,
    error: "Esta app no tiene ese permiso.",
  });
});
it("uploads bytes as base64 and returns downloaded bytes as a transferred buffer", async () => {
  const { frame, replies, transfers } = await mount(site({ storage: false, files: true }));
  files.put.mockResolvedValue({ files: 1, bytes: 3 });
  const buffer = new TextEncoder().encode("abc").buffer;
  await send(
    frame,
    message({ op: "file.put", name: "clips/a.mp4", mimeType: "video/mp4", data: buffer }),
  );
  expect(files.put).toHaveBeenCalledWith({
    id: "site-a",
    preview: false,
    name: "clips/a.mp4",
    mimeType: "video/mp4",
    contentBase64: btoa("abc"),
  });
  expect(replies.at(-1)).toMatchObject({ ok: true, usage: { files: 1, bytes: 3 } });
  files.get.mockResolvedValue({ mimeType: "video/mp4", contentBase64: btoa("xyz") });
  await send(frame, message({ op: "file.get", name: "clips/a.mp4", id: "r2" }));
  const reply = replies.at(-1) as { data: ArrayBuffer; mimeType: string; ok: boolean };
  expect(reply.ok).toBe(true);
  expect(reply.mimeType).toBe("video/mp4");
  expect(new TextDecoder().decode(reply.data)).toBe("xyz");
  expect(transfers.at(-1)).toEqual([reply.data]);
});
