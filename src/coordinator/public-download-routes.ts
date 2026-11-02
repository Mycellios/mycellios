import type { FastifyInstance } from "fastify";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  PUBLIC_DOWNLOADS_SCHEMA,
  publicDownloadAvailabilitySchema,
  publicWindowsInstallerIntegritySchema,
} from "../contracts/public-downloads.js";
import type { NativeReleaseTransactionStore } from "./release-upload.js";

const NATIVE_DOWNLOADS = [
  { id: "windows-x64", label: "Windows 10/11 · x64", format: "MSI", suffix: "windows-x64.msi", legacyFormat: "ZIP", legacyFileName: "mycellios-node-windows-x64.zip", path: "/downloads/windows" },
  { id: "macos-arm64", label: "macOS · Apple Silicon", format: "PKG", suffix: "macos-arm64.pkg", legacyFormat: "TAR.GZ", legacyFileName: "mycellios-node-macos-arm64.tar.gz", path: "/downloads/macos-arm64" },
  { id: "linux-x64", label: "Linux · x64", format: "DEB", suffix: "linux-x64.deb", legacyFormat: "TAR.GZ", legacyFileName: "mycellios-node-linux-x64.tar.gz", path: "/downloads/linux" },
] as const;

export function registerPublicDownloadRoutes(
  app: FastifyInstance,
  options: {
    version: string;
    downloadsRoot: string | null;
    transactions: NativeReleaseTransactionStore | null;
  },
): void {
  const hashes = new Map<string, { stamp: string; digest: Promise<string> }>();
  const publishedVersion = () => options.transactions?.publishedVersion ?? options.version;
  const assetHash = (path: string): Promise<string> => {
    const info = lstatSync(path);
    const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    const cached = hashes.get(path);
    if (cached?.stamp === stamp) return cached.digest;
    const digest = (async () => {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      return hash.digest("hex");
    })();
    hashes.set(path, { stamp, digest });
    void digest.catch(() => { if (hashes.get(path)?.digest === digest) hashes.delete(path); });
    return digest;
  };
  const resolveAsset = async (fileName: string) => options.transactions
    ? options.transactions.publicAssetPath("downloads", fileName)
    : options.downloadsRoot
      ? resolve(options.downloadsRoot, fileName)
      : null;
  const available = (filePath: string | null): boolean => {
    if (!filePath) return false;
    try {
      const details = lstatSync(filePath);
      return details.isFile() && !details.isSymbolicLink() && details.size > 0;
    } catch {
      return false;
    }
  };

  const packageFor = async (target: typeof NATIVE_DOWNLOADS[number], version: string) => {
    const fileName = `mycellios-node-${version}-${target.suffix}`;
    const assetPath = await resolveAsset(fileName);
    if (available(assetPath)) {
      return { id: target.id, label: target.label, format: target.format, fileName, path: target.path, available: true };
    }
    if (available(await resolveAsset(target.legacyFileName))) {
      return { id: target.id, label: target.label, format: target.legacyFormat, fileName: target.legacyFileName, path: target.path, available: true };
    }
    return { id: target.id, label: target.label, format: target.format, fileName, path: target.path, available: false };
  };

  app.get("/public/v1/downloads", async (_request, reply) => {
    const version = publishedVersion();
    const packages = await Promise.all(NATIVE_DOWNLOADS.map((target) => packageFor(target, version)));
    reply.header("Cache-Control", "public, max-age=30");
    return publicDownloadAvailabilitySchema.parse({
      schema: PUBLIC_DOWNLOADS_SCHEMA,
      version,
      packages,
    });
  });

  app.get("/public/v1/downloads/windows-x64/integrity", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const version = publishedVersion();
    const fileName = `mycellios-node-${version}-windows-x64.msi`;
    const path = await resolveAsset(fileName);
    if (!available(path)) return reply.code(503).send({ error: { code: "windows_installer_unavailable" } });
    return publicWindowsInstallerIntegritySchema.parse({
      schema: "mycellios-windows-installer-integrity/1",
      version, fileName, sha256: await assetHash(path!),
    });
  });

  for (const target of NATIVE_DOWNLOADS) {
    app.get(target.path, async (_request, reply) => {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      const version = publishedVersion();
      const selected = await packageFor(target, version);
      if (!selected.available) {
        return reply.redirect(`/downloads?availability=unavailable&platform=${target.id}`);
      }
      return reply.redirect(`/downloads/${selected.fileName}?v=${version}`);
    });
  }
  app.get("/downloads/linux-deb", async (_request, reply) => reply.redirect("/downloads/linux"));
  app.get("/downloads/linux-rpm", async (_request, reply) =>
    reply.redirect("/downloads?availability=unsupported&platform=linux-rpm"));
}
