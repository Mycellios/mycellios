import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { nativeCommandAvailable } from "./native-agent-process.js";

export const MANAGED_OPENCODE_VERSION = "1.19.5";
const packageName = "opencode-windows-x64-baseline";
const archiveUrl = `https://registry.npmjs.org/${packageName}/-/${packageName}-${MANAGED_OPENCODE_VERSION}.tgz`;
const archiveHash = "yRHN+TsfLjfLmdQVAVWqTGfGP1yq8YtUFy9Jw33XhlPIp77slBdCJrj2PC4amuEl6BJtaIQDhDFbpJ8+a5z7Qw==";
const executableHash = "6f15c8f241f3df22375f174753193a71c488f6c0a6bbbae3f9fa34d112673b7b";
const executableBytes = 211_564_424;
const installations = new Map<string, Promise<void>>();

function archiveTool() {
  if (process.platform !== "win32" || process.arch !== "x64" || !process.env.SystemRoot) return null;
  const command = join(process.env.SystemRoot, "System32", "tar.exe");
  return nativeCommandAvailable({ command }) ? command : null;
}

export function supportsManagedOpenCode(dataDir: string | undefined) {
  return Boolean(dataDir && isAbsolute(dataDir) && archiveTool());
}

export function managedOpenCodeCommand(dataDir: string | undefined) {
  if (process.platform !== "win32" || process.arch !== "x64" || !dataDir || !isAbsolute(dataDir))
    return null;
  const command = {
    command: join(dataDir, "provider-runtimes", "opencode", MANAGED_OPENCODE_VERSION, "opencode.exe"),
    args: ["acp"],
  };
  return nativeCommandAvailable(command) ? command : null;
}

function verifyBytes(
  maxBytes: number, algorithm: "sha256" | "sha512", encoding: "hex" | "base64", digest: string,
  exactBytes?: number,
) {
  const hash = createHash(algorithm);
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) return callback(new Error("OpenCode artifact exceeds its size limit"));
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      if (hash.digest(encoding) !== digest || (exactBytes !== undefined && size !== exactBytes)) {
        callback(new Error("OpenCode artifact failed its integrity check"));
        return;
      }
      callback();
    },
  });
}

async function install(dataDir: string, directory: string, tar: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(directory, "install-"));
  const archive = join(staging, "opencode.tgz");
  const executable = join(staging, "opencode.exe");
  const signal = AbortSignal.timeout(180_000);
  try {
    const response = await fetch(archiveUrl, { redirect: "error", signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Could not download OpenCode");
    }
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      verifyBytes(100 * 1024 * 1024, "sha512", "base64", archiveHash),
      createWriteStream(archive, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    // Stream one verified member to a filename we own. No archive paths are extracted to disk.
    const child = spawn(tar, ["-xOf", archive, "package/bin/opencode.exe"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      signal,
    });
    const finished = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("Could not unpack OpenCode"));
      });
    });
    try {
      await Promise.all([
        finished,
        pipeline(
          child.stdout,
          verifyBytes(executableBytes, "sha256", "hex", executableHash, executableBytes),
          createWriteStream(executable, { flags: "wx", mode: 0o700 }),
          { signal },
        ),
      ]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await finished.catch(() => undefined);
    }
    try {
      await rename(executable, join(directory, "opencode.exe"));
    } catch (error) {
      if (!managedOpenCodeCommand(dataDir)) throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function installManagedOpenCode(dataDir: string) {
  const tar = archiveTool();
  if (!tar || !isAbsolute(dataDir)) throw new Error("Managed OpenCode is unavailable on this server");
  if (managedOpenCodeCommand(dataDir)) return;
  const directory = join(dataDir, "provider-runtimes", "opencode", MANAGED_OPENCODE_VERSION);
  let pending = installations.get(directory);
  if (!pending) {
    pending = install(dataDir, directory, tar).finally(() => installations.delete(directory));
    installations.set(directory, pending);
  }
  await pending;
}
