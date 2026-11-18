import { HostedWebDataKey } from "@rakazo/contracts";
import { type RefObject, useEffect, useRef } from "react";
import * as z from "zod";
import type { createSpaceRpc } from "../../lib/rpc";

/**
 * Message protocol between a sandboxed Hifa Store app and its host page.
 * The app posts `{ type, id, op, key?, value?, prefix? }` to `parent`; the host
 * answers `{ type, id, ok, value? | entries? | usage? | error? }`.
 */
export const APP_STORAGE_MESSAGE = "mycellios.storage";
const Request = z
  .object({
    type: z.literal(APP_STORAGE_MESSAGE),
    id: z.string().min(1).max(64),
    op: z.enum(["get", "set", "delete", "list"]),
    key: HostedWebDataKey.optional(),
    value: z.json().optional(),
    prefix: z.string().max(200).optional(),
  })
  .strict();
const MAX_PENDING = 32;

type DataClient = ReturnType<typeof createSpaceRpc>["webs"]["data"];
export type StorageTarget = { id: string; preview: boolean };

/**
 * Answers only the exact iframe this host rendered; the app never learns the session,
 * user or Space. The target comes from the host, never from the message.
 */
export function useAppStorageBridge(
  frame: RefObject<HTMLIFrameElement | null>,
  target: StorageTarget | null,
  client: DataClient,
) {
  const id = target?.id;
  const preview = target?.preview;
  // RPC proxies may be recreated per render; keep one listener per target.
  const latest = useRef(client);
  latest.current = client;
  useEffect(() => {
    if (!id || preview === undefined) return;
    let pending = 0;
    let alive = true;
    async function handle(request: z.infer<typeof Request>) {
      const where = { id: id!, preview: preview! };
      const client = latest.current;
      switch (request.op) {
        case "get":
          return client.get({ ...where, key: request.key! });
        case "set":
          if (request.value === undefined) throw new Error("Falta el valor.");
          return { usage: await client.set({ ...where, key: request.key!, value: request.value }) };
        case "delete":
          return { usage: await client.delete({ ...where, key: request.key! }) };
        case "list":
          return client.list({ ...where, prefix: request.prefix ?? "" });
      }
    }
    function onMessage(event: MessageEvent) {
      const source = frame.current?.contentWindow;
      if (!source || event.source !== source) return;
      const parsed = Request.safeParse(event.data);
      if (!parsed.success) return;
      const request = parsed.data;
      const reply = (body: Record<string, unknown>) => {
        // The sandboxed origin is opaque ("null"), so "*" is the only valid target;
        // the reply goes to the same window object that asked.
        if (alive) source.postMessage({ type: APP_STORAGE_MESSAGE, id: request.id, ...body }, "*");
      };
      if (request.op !== "list" && !request.key)
        return reply({ ok: false, error: "Falta la clave." });
      if (pending >= MAX_PENDING)
        return reply({ ok: false, error: "Demasiadas peticiones a la vez." });
      pending++;
      handle(request)
        .then((result) => reply({ ok: true, ...result }))
        .catch((error: unknown) =>
          reply({
            ok: false,
            error: error instanceof Error ? error.message : "No se pudo guardar.",
          }),
        )
        .finally(() => {
          pending--;
        });
    }
    window.addEventListener("message", onMessage);
    return () => {
      alive = false;
      window.removeEventListener("message", onMessage);
    };
  }, [frame, id, preview]);
}
