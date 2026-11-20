import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * At-rest protection for the local server's identity file. Desktop keeps the 32-byte
 * data key in the operating system's secret store and hands it to this process in
 * memory; the identity file on disk then holds only AES-256-GCM ciphertext.
 */
const PROTECTED_PREFIX = "mycellios-protected-identity:v1:";
const ASSOCIATED_DATA = Buffer.from("mycellios local identity v1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class LocalDataKeyUnavailableError extends Error {
  constructor() {
    super("Local data is protected and its key is not available on this device.");
    this.name = "LocalDataKeyUnavailableError";
  }
}

/** Accepts exactly 64 lowercase hex characters; anything else is no key at all. */
export function parseLocalDataKey(value: string | undefined): Buffer | undefined {
  return value && /^[a-f0-9]{64}$/.test(value) ? Buffer.from(value, "hex") : undefined;
}

export function isProtectedIdentity(contents: string): boolean {
  return contents.startsWith(PROTECTED_PREFIX);
}

export function protectIdentity(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(ASSOCIATED_DATA);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${PROTECTED_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

/** Throws on a missing key, a wrong key or modified ciphertext; never returns partial data. */
export function unprotectIdentity(contents: string, key: Buffer | undefined): string {
  if (!isProtectedIdentity(contents)) throw new Error("The identity file is not protected.");
  if (!key) throw new LocalDataKeyUnavailableError();
  const packed = Buffer.from(contents.slice(PROTECTED_PREFIX.length), "base64");
  if (packed.length <= IV_BYTES + TAG_BYTES) throw new Error("The protected identity is truncated.");
  const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, IV_BYTES));
  decipher.setAAD(ASSOCIATED_DATA);
  decipher.setAuthTag(packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(packed.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

export type LocalIdentity = {
  databasePassword: string;
  appPassword: string;
  authSecret: string;
  encryptionKey: string;
  screenProxySecret: string;
};

const IDENTITY_FIELDS = [
  "databasePassword",
  "appPassword",
  "authSecret",
  "encryptionKey",
  "screenProxySecret",
] as const;

function parseIdentity(contents: string): LocalIdentity {
  const identity = JSON.parse(contents) as LocalIdentity;
  if (
    !Object.values(identity).every(
      (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    ) ||
    Object.keys(identity).length !== IDENTITY_FIELDS.length
  )
    throw new Error("Invalid local identity");
  return identity;
}

/**
 * Reads, creates or protects the local identity. An existing identity is never replaced:
 * a protected file without its key fails instead of starting an empty installation, and a
 * plaintext file is replaced only after its protected copy has been read back intact.
 * Without a key (development previews, platforms without a usable store) the file stays
 * plaintext, as before.
 */
export async function localIdentity(dataDir: string, dataKey?: Buffer): Promise<LocalIdentity> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "identity.json");
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
    const identity = Object.fromEntries(
      IDENTITY_FIELDS.map((key) => [key, randomBytes(32).toString("hex")]),
    ) as LocalIdentity;
    const plaintext = JSON.stringify(identity);
    await writeFile(file, dataKey ? protectIdentity(plaintext, dataKey) : plaintext, {
      mode: 0o600,
      flag: "wx",
    });
    return identity;
  }
  if (isProtectedIdentity(contents)) return parseIdentity(unprotectIdentity(contents, dataKey));
  const identity = parseIdentity(contents);
  // A failed upgrade leaves the readable plaintext file in place for the next start.
  if (dataKey) await protectExistingIdentity(file, contents, dataKey).catch(() => undefined);
  return identity;
}

async function protectExistingIdentity(file: string, plaintext: string, dataKey: Buffer) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, protectIdentity(plaintext, dataKey), { mode: 0o600, flag: "wx" });
    if (unprotectIdentity(await readFile(temporary, "utf8"), dataKey) !== plaintext)
      throw new Error("Protected identity verification failed");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
