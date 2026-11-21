import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
} from "baileys";
import type { WhatsAppLinkMode } from "../../../../../contracts/desktop-whatsapp.js";
import { readPrivateFile, writePrivateFile } from "../setup-store.js";
import type { WhatsAppRuntime } from "./types.js";

/**
 * Baileys keys for one linked number, in one owner-only file under userData:
 * `whatsapp/<localId>.json.enc`, AES-256-GCM with a key wrapped by the OS secret
 * store (see local-data-key.ts). The local id is bound as associated data, so
 * files cannot be swapped between links. Nothing here is ever logged.
 */
export const WHATSAPP_DIRECTORY = "whatsapp";
export const WHATSAPP_KEY_FILE = "whatsapp-key.json";
const SUFFIX = ".json.enc";
const PREFIX = "mwa1.";
const MAX_FILE_BYTES = 48 * 1024 * 1024;
const MAX_SENT_IDS = 5_000;
const LOCAL_ID = /^[a-f0-9-]{36}$/;

/** Who owns this link on the server, and how it answers. */
export interface WhatsAppLinkMeta {
  localId: string;
  botId: string;
  mode: WhatsAppLinkMode;
  /** Server and account the link was registered with; other accounts never drive it. */
  base: string;
  userId: string;
  linkId?: string;
  phone?: string;
  /** Space selected in the app when linking started (the Mico's Space). */
  spaceId?: string;
}

type Keys = { [T in keyof SignalDataTypeMap]?: Record<string, unknown> };
interface Stored {
  v: 1;
  meta: WhatsAppLinkMeta;
  creds: AuthenticationCreds;
  keys: Keys;
  sent: string[];
}

const aad = (localId: string) => Buffer.from(`mycellios-whatsapp-auth-v1\0${localId}`, "utf8");

export function sealWhatsAppState(key: Buffer, localId: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(localId));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Throws on a wrong key, a different link or any modified byte. */
export function openWhatsAppState(key: Buffer, localId: string, sealed: string): string {
  if (!sealed.startsWith(PREFIX)) throw new Error("Unknown WhatsApp key format");
  const raw = Buffer.from(sealed.slice(PREFIX.length), "base64");
  if (raw.length < 29) throw new Error("Damaged WhatsApp keys");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(aad(localId));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export async function listWhatsAppLinkFiles(userDataDir: string): Promise<string[]> {
  try {
    const names = await readdir(path.join(userDataDir, WHATSAPP_DIRECTORY));
    return names
      .filter((name) => name.endsWith(SUFFIX) && LOCAL_ID.test(name.slice(0, -SUFFIX.length)))
      .map((name) => name.slice(0, -SUFFIX.length));
  } catch {
    return [];
  }
}

export class WhatsAppAuthFile {
  readonly state: AuthenticationState;
  private writing: Promise<void> = Promise.resolve();
  private pending?: Promise<void>;
  private removed = false;
  private sentSet: Set<string>;

  private constructor(
    private readonly file: string,
    private readonly key: Buffer,
    private readonly runtime: WhatsAppRuntime,
    private stored: Stored,
  ) {
    this.sentSet = new Set(stored.sent);
    const keys = stored.keys;
    this.state = {
      creds: stored.creds,
      keys: {
        get: async (type, ids) => {
          const bucket: Record<string, unknown> = keys[type] ?? {};
          const out: Record<string, unknown> = {};
          for (const id of ids) {
            let value = bucket[id];
            if (value !== undefined && value !== null && type === "app-state-sync-key")
              value = this.runtime.appStateSyncKey(value);
            if (value !== undefined && value !== null) out[id] = value;
          }
          return out as never;
        },
        set: async (data: SignalDataSet) => {
          for (const type of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
            if (!keys[type]) keys[type] = {};
            const bucket = keys[type];
            for (const [id, value] of Object.entries(
              (data[type] ?? {}) as Record<string, unknown>,
            )) {
              if (value === null || value === undefined) delete bucket[id];
              else bucket[id] = value;
            }
          }
          await this.save();
        },
        clear: async () => {
          for (const type of Object.keys(keys) as Array<keyof SignalDataTypeMap>) delete keys[type];
          await this.save();
        },
      },
    };
  }

  static path(userDataDir: string, localId: string) {
    if (!LOCAL_ID.test(localId)) throw new Error("Invalid WhatsApp link id");
    return path.join(userDataDir, WHATSAPP_DIRECTORY, localId + SUFFIX);
  }

  static async create(
    userDataDir: string,
    key: Buffer,
    runtime: WhatsAppRuntime,
    meta: WhatsAppLinkMeta,
  ) {
    await mkdir(path.join(userDataDir, WHATSAPP_DIRECTORY), { recursive: true, mode: 0o700 });
    const auth = new WhatsAppAuthFile(
      WhatsAppAuthFile.path(userDataDir, meta.localId),
      key,
      runtime,
      {
        v: 1,
        meta,
        creds: runtime.initAuthCreds(),
        keys: {},
        sent: [],
      },
    );
    await auth.save();
    return auth;
  }

  /** Returns null when the file is missing; throws when it exists but cannot be opened. */
  static async open(userDataDir: string, key: Buffer, runtime: WhatsAppRuntime, localId: string) {
    const file = WhatsAppAuthFile.path(userDataDir, localId);
    const sealed = await readPrivateFile(file, MAX_FILE_BYTES);
    if (sealed === null) return null;
    const stored = JSON.parse(openWhatsAppState(key, localId, sealed), (k, v) =>
      runtime.reviver(k, v),
    ) as Stored;
    if (stored.v !== 1 || stored.meta?.localId !== localId || !stored.creds)
      throw new Error("Damaged WhatsApp keys");
    stored.keys ??= {};
    stored.sent = Array.isArray(stored.sent)
      ? stored.sent.filter((id) => typeof id === "string").slice(-MAX_SENT_IDS)
      : [];
    return new WhatsAppAuthFile(file, key, runtime, stored);
  }

  get meta(): WhatsAppLinkMeta {
    return this.stored.meta;
  }

  async updateMeta(patch: Partial<Omit<WhatsAppLinkMeta, "localId">>) {
    this.stored.meta = { ...this.stored.meta, ...patch };
    await this.save();
  }

  /** Remembers a message id this connector sent, so its echo is never uploaded. */
  rememberSent(id: string) {
    if (this.sentSet.has(id)) return;
    this.sentSet.add(id);
    this.stored.sent.push(id);
    if (this.stored.sent.length > MAX_SENT_IDS) {
      for (const old of this.stored.sent.splice(0, this.stored.sent.length - MAX_SENT_IDS))
        this.sentSet.delete(old);
    }
    void this.save().catch(() => undefined);
  }

  sentIds(): ReadonlySet<string> {
    return this.sentSet;
  }

  /** Coalesces writes: every caller resolves after a write that includes its change. */
  save(): Promise<void> {
    if (this.removed) return Promise.resolve();
    if (this.pending) return this.pending;
    const next = this.writing
      .catch(() => undefined)
      .then(async () => {
        this.pending = undefined;
        if (this.removed) return;
        const plaintext = JSON.stringify(this.stored, (k, v) => this.runtime.replacer(k, v));
        await writePrivateFile(
          this.file,
          sealWhatsAppState(this.key, this.stored.meta.localId, plaintext),
        );
      });
    this.pending = next;
    this.writing = next;
    return next;
  }

  async remove() {
    this.removed = true;
    await this.writing.catch(() => undefined);
    await rm(this.file, { force: true });
  }
}
