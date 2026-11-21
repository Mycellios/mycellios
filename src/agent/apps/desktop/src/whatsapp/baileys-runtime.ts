/**
 * The only module that imports Baileys. scripts/build.mjs bundles it into its own
 * dist/whatsapp-runtime.js, which main loads with a dynamic import only when a
 * WhatsApp link exists or the owner starts linking (startup stays unaffected).
 *
 * Baileys is MIT; its Signal dependencies are GPL-3.0 (libsignal) and contain
 * AGPL-3.0 code (whatsapp-rust-bridge). See specs/whatsapp-linked-device/spec.md.
 */

import type { AuthenticationCreds, SocketConfig, WAMessage } from "baileys";
import makeWASocket, {
  Browsers,
  BufferJSON,
  DisconnectReason,
  downloadMediaMessage,
  generateMessageIDV2,
  initAuthCreds,
  proto,
} from "baileys";
import type { WhatsAppRuntime, WhatsAppSocket } from "./types.js";

type ILogger = SocketConfig["logger"];
const silent: ILogger = {
  level: "silent",
  child: () => silent,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const runtime: WhatsAppRuntime = {
  makeSocket: ({ auth, getMessage }) =>
    makeWASocket({
      auth,
      logger: silent,
      browser: Browsers.appropriate("Chrome"),
      // A linked assistant must not look "online" or pull the owner's history.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      getMessage,
    }) as unknown as WhatsAppSocket,
  initAuthCreds: (): AuthenticationCreds => initAuthCreds(),
  replacer: BufferJSON.replacer,
  reviver: BufferJSON.reviver,
  appStateSyncKey: (value) =>
    proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>),
  loggedOut: DisconnectReason.loggedOut,
  restartRequired: DisconnectReason.restartRequired,
  forbidden: DisconnectReason.forbidden,
  connectionReplaced: DisconnectReason.connectionReplaced,
  messageId: (userJid) => generateMessageIDV2(userJid),
  download: async (message, socket) =>
    (await downloadMediaMessage(
      message as WAMessage,
      "buffer",
      {},
      {
        logger: silent,
        reuploadRequest: (m) => socket.updateMediaMessage(m),
      },
    )) as Buffer,
};
