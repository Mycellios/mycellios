import { HOSTED_WEB_FILE_DEFAULTS, HostedWebDataKey } from "@mycellios/contracts";
import { type RefObject, useEffect, useRef } from "react";
import * as z from "zod";
import type { createSpaceRpc } from "../../lib/rpc";

/**
 * Message protocol between a sandboxed Hifa Store app and its host page.
 * The app posts `{ type, id, op, ... }` to `parent`; the host answers
 * `{ type, id, ok, ... | error }`.
 * - `storage`: get/set/delete/list with `key`, `value`, `prefix`.
 * - `files`: file.put (`name`, `mimeType`, `data` Blob/ArrayBuffer), file.get
 *   (replies `mimeType` + transferred `data` ArrayBuffer), file.delete, file.list.
 */
export const APP_STORAGE_MESSAGE = "mycellios.storage";
/** Realm-independent: structured clones may come from another global object. */
const tag = (value: unknown) => Object.prototype.toString.call(value);
const isBlob = (value: unknown): value is Blob =>
  tag(value) === "[object Blob]" || tag(value) === "[object File]";
function isBinary(value: unknown): value is Blob | ArrayBuffer {
  return isBlob(value) || tag(value) === "[object ArrayBuffer]";
}
const base = {
  type: z.literal(APP_STORAGE_MESSAGE),
  id: z.string().min(1).max(64),
};
const Request = z.discriminatedUnion("op", [
  z.object({ ...base, op: z.literal("get"), key: HostedWebDataKey }).strict(),
  z.object({ ...base, op: z.literal("set"), key: HostedWebDataKey, value: z.json() }).strict(),
  z.object({ ...base, op: z.literal("delete"), key: HostedWebDataKey }).strict(),
  z.object({ ...base, op: z.literal("list"), prefix: z.string().max(200).optional() }).strict(),
  z
    .object({
      ...base,
      op: z.literal("file.put"),
      name: HostedWebDataKey,
      mimeType: z.string().max(120),
      data: z.custom<Blob | ArrayBuffer>(isBinary),
    })
    .strict(),
  z.object({ ...base, op: z.literal("file.get"), name: HostedWebDataKey }).strict(),
  z.object({ ...base, op: z.literal("file.delete"), name: HostedWebDataKey }).strict(),
  z.object({ ...base, op: z.literal("file.list") }).strict(),
]);
type Request = z.infer<typeof Request>;
const MAX_PENDING = 32;
/** Large payloads are held in memory while encoding; keep very few in flight. */
const MAX_PENDING_FILES = 2;

type WebsClient = Pick<ReturnType<typeof createSpaceRpc>["webs"], "data" | "files">;
export type StorageTarget = { id: string; preview: boolean; storage: boolean; files: boolean };

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/**
 * Answers only the exact iframe this host rendered; the app never learns the session,
 * user or Space. The target and its grants come from the host, never from the message.
 */
export function useAppStorageBridge(
  frame: RefObject<HTMLIFrameElement | null>,
  target: StorageTarget | null,
  client: WebsClient,
) {
  const id = target?.id;
  const preview = target?.preview;
  const storage = target?.storage ?? false;
  const files = target?.files ?? false;
  // RPC proxies may be recreated per render; keep one listener per target.
  const latest = useRef(client);
  latest.current = client;
  useEffect(() => {
    if (!id || preview === undefined || (!storage && !files)) return;
    let pending = 0;
    let pendingFiles = 0;
    let alive = true;
    async function handle(request: Request): Promise<[Record<string, unknown>, Transferable[]]> {
      const where = { id: id!, preview: preview! };
      const { data, files: fileClient } = latest.current;
      switch (request.op) {
        case "get":
          return [await data.get({ ...where, key: request.key }), []];
        case "set":
          return [
            { usage: await data.set({ ...where, key: request.key, value: request.value }) },
            [],
          ];
        case "delete":
          return [{ usage: await data.delete({ ...where, key: request.key }) }, []];
        case "list":
          return [await data.list({ ...where, prefix: request.prefix ?? "" }), []];
        case "file.put": {
          const size = isBlob(request.data) ? request.data.size : request.data.byteLength;
          if (size > HOSTED_WEB_FILE_DEFAULTS.fileBytes)
            throw new Error("El archivo es demasiado grande.");
          const buffer = isBlob(request.data) ? await request.data.arrayBuffer() : request.data;
          const usage = await fileClient.put({
            ...where,
            name: request.name,
            mimeType: request.mimeType,
            contentBase64: toBase64(new Uint8Array(buffer)),
          });
          return [{ usage }, []];
        }
        case "file.get": {
          const file = await fileClient.get({ ...where, name: request.name });
          const bytes = fromBase64(file.contentBase64);
          return [{ mimeType: file.mimeType, data: bytes.buffer }, [bytes.buffer]];
        }
        case "file.delete":
          return [{ usage: await fileClient.delete({ ...where, name: request.name }) }, []];
        case "file.list":
          return [await fileClient.list(where), []];
      }
    }
    function onMessage(event: MessageEvent) {
      const source = frame.current?.contentWindow;
      if (!source || event.source !== source) return;
      const parsed = Request.safeParse(event.data);
      if (!parsed.success) return;
      const request = parsed.data;
      const reply = (body: Record<string, unknown>, transfer: Transferable[] = []) => {
        // The sandboxed origin is opaque ("null"), so "*" is the only valid target;
        // the reply goes to the same window object that asked.
        if (alive)
          source.postMessage({ type: APP_STORAGE_MESSAGE, id: request.id, ...body }, "*", transfer);
      };
      const isFile = request.op.startsWith("file.");
      if (isFile ? !files : !storage)
        return reply({ ok: false, error: "Esta app no tiene ese permiso." });
      if (pending >= MAX_PENDING || (isFile && pendingFiles >= MAX_PENDING_FILES))
        return reply({ ok: false, error: "Demasiadas peticiones a la vez." });
      pending++;
      if (isFile) pendingFiles++;
      handle(request)
        .then(([result, transfer]) => reply({ ok: true, ...result }, transfer))
        .catch((error: unknown) =>
          reply({
            ok: false,
            error: error instanceof Error ? error.message : "No se pudo guardar.",
          }),
        )
        .finally(() => {
          pending--;
          if (isFile) pendingFiles--;
        });
    }
    window.addEventListener("message", onMessage);
    return () => {
      alive = false;
      window.removeEventListener("message", onMessage);
    };
  }, [frame, id, preview, storage, files]);
}
