import type {
  AnyMessageContent,
  AuthenticationCreds,
  AuthenticationState,
  BaileysEventMap,
  Contact,
  MiscMessageGenerationOptions,
  proto,
  WAMessage,
  WAMessageKey,
} from "baileys";

export type { WAMessage, WAMessageKey };

/** The part of a Baileys socket the connector uses; tests provide a fake. */
export interface WhatsAppSocket {
  user: Contact | undefined;
  ev: {
    on<T extends keyof BaileysEventMap>(
      event: T,
      listener: (arg: BaileysEventMap[T]) => void,
    ): void;
    off<T extends keyof BaileysEventMap>(
      event: T,
      listener: (arg: BaileysEventMap[T]) => void,
    ): void;
  };
  signalRepository?: { lidMapping?: { getPNForLID(lid: string): Promise<string | null> } };
  requestPairingCode(phoneNumber: string): Promise<string>;
  sendMessage(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined>;
  groupFetchAllParticipating(): Promise<Record<string, { id: string; subject?: string }>>;
  groupMetadata(jid: string): Promise<{ id: string; subject?: string }>;
  updateMediaMessage(message: WAMessage): Promise<WAMessage>;
  logout(msg?: string): Promise<void>;
  end(error: Error | undefined): void;
}

/** Everything main needs from Baileys, loaded lazily from dist/whatsapp-runtime.js. */
export interface WhatsAppRuntime {
  makeSocket(options: {
    auth: AuthenticationState;
    getMessage(key: WAMessageKey): Promise<proto.IMessage | undefined>;
  }): WhatsAppSocket;
  initAuthCreds(): AuthenticationCreds;
  replacer(key: string, value: unknown): unknown;
  reviver(key: string, value: unknown): unknown;
  appStateSyncKey(value: unknown): unknown;
  loggedOut: number;
  restartRequired: number;
  forbidden: number;
  connectionReplaced: number;
  messageId(userJid?: string): string;
  download(message: WAMessage, socket: WhatsAppSocket): Promise<Buffer>;
}
