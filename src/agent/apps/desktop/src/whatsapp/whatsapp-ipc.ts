import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { normalizeWhatsAppPhone } from "../../../../../contracts/desktop-whatsapp.js";
import { desktopDeviceId } from "../account-computer.js";
import type { OsSecretStore } from "../local-data-key.js";
import { loadLocalDataKey } from "../local-data-key.js";
import type { AccountContext } from "./api-client.js";
import { listWhatsAppLinkFiles, WHATSAPP_KEY_FILE } from "./auth-store.js";
import type { WhatsAppRuntime } from "./types.js";
import type { WhatsAppLinkRequest, WhatsAppStatus } from "./whatsapp-connector.js";
import { WhatsAppConnector } from "./whatsapp-connector.js";

/** Built next to main.js by scripts/build.mjs; loaded only when WhatsApp is used. */
export function whatsAppRuntimeFile() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "whatsapp-runtime.js");
}

export function parseWhatsAppLinkRequest(value: unknown): WhatsAppLinkRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid WhatsApp link");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["botId", "mode", "method", "phone"].includes(key)))
    throw new Error("Invalid WhatsApp link");
  if (typeof input.botId !== "string" || !input.botId || input.botId.length > 256)
    throw new Error("Invalid WhatsApp link");
  if (input.mode !== "personal" && input.mode !== "dedicated")
    throw new Error("Invalid WhatsApp mode");
  if (input.method !== "qr" && input.method !== "pairing_code")
    throw new Error("Invalid WhatsApp link method");
  let phone: string | undefined;
  if (input.phone !== undefined && input.phone !== null && input.phone !== "") {
    phone =
      typeof input.phone === "string" && input.phone.length <= 32
        ? (normalizeWhatsAppPhone(input.phone) ?? undefined)
        : undefined;
    if (!phone) throw new Error("Invalid WhatsApp phone");
  }
  if (input.method === "pairing_code" && !phone)
    throw new Error("The pairing code needs the phone number.");
  return {
    botId: input.botId,
    mode: input.mode,
    method: input.method,
    ...(phone ? { phone } : {}),
  };
}

const sessionKey = (value: unknown) => {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value))
    throw new Error("Invalid WhatsApp session");
  return value;
};
const linkId = (value: unknown) => {
  if (typeof value !== "string" || !value || value.length > 256)
    throw new Error("Invalid WhatsApp link");
  return value;
};

/**
 * `desktop.whatsapp.*` IPC for the trusted main frame only (same check as the
 * desktop.computer handlers). WhatsApp keys and messages never reach the renderer;
 * it receives the link status, the QR payload and the pairing code.
 */
export function installWhatsApp(options: {
  ipcMain: IpcMain;
  userDataDir: string;
  platform: NodeJS.Platform;
  store: OsSecretStore;
  authorize(event: IpcMainInvokeEvent): boolean;
  context(): Promise<AccountContext | null>;
  space(): Promise<string | null>;
  send(status: WhatsAppStatus[]): void;
}) {
  const runtimeFile = whatsAppRuntimeFile();
  const connector = new WhatsAppConnector({
    userDataDir: options.userDataDir,
    dataKey: async () => {
      const key = await loadLocalDataKey({
        userDataDir: options.userDataDir,
        platform: options.platform,
        store: options.store,
        protectedDataExists: (await listWhatsAppLinkFiles(options.userDataDir)).length > 0,
        fileName: WHATSAPP_KEY_FILE,
      });
      return Buffer.from(key, "hex");
    },
    runtime: async () =>
      ((await import(pathToFileURL(runtimeFile).href)) as { runtime: WhatsAppRuntime }).runtime,
    context: options.context,
    deviceId: () => desktopDeviceId(options.userDataDir),
    space: options.space,
    emit: options.send,
  });
  const guard = (event: IpcMainInvokeEvent) => {
    if (!options.authorize(event))
      throw new Error("WhatsApp is available only in the Mycellios app window.");
  };
  options.ipcMain.handle(
    "desktop.whatsapp.available",
    (event) => options.authorize(event) && existsSync(runtimeFile),
  );
  options.ipcMain.handle("desktop.whatsapp.status", (event) => {
    guard(event);
    return connector.currentStatus();
  });
  options.ipcMain.handle("desktop.whatsapp.link", (event, input: unknown) => {
    guard(event);
    if (!existsSync(runtimeFile)) throw new Error("WhatsApp is not included in this build.");
    return connector.link(parseWhatsAppLinkRequest(input));
  });
  options.ipcMain.handle("desktop.whatsapp.cancel", async (event, value: unknown) => {
    guard(event);
    await connector.cancel(sessionKey(value));
  });
  options.ipcMain.handle("desktop.whatsapp.disconnect", async (event, value: unknown) => {
    guard(event);
    await connector.disconnect(linkId(value));
  });
  connector.start();
  return connector;
}
