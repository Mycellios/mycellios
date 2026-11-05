import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { canonicalAppJson, type AppManifest } from "../../packages/contracts/src/app-manifest.js";
import { validateAppManifest, validateAppVersionChange, type AppValidationIssue } from "../../packages/contracts/src/app-validation.js";

const MANIFEST_LIMIT = 1024 * 1024;
const ASSET_LIMIT = 8 * 1024 * 1024;
const BUNDLE_LIMIT = 16 * 1024 * 1024;
type CheckedBundle = { ok: true; manifest: AppManifest; digest: string };
type FailedBundle = { ok: false; issues: AppValidationIssue[] };

async function readBounded(file: string, limit: number): Promise<Buffer> {
  const info = await stat(file);
  if (!info.isFile() || info.size > limit) throw new Error("Not a bounded regular file");
  const parts: Buffer[] = [];
  let length = 0;
  for await (const part of createReadStream(file, { end: limit, highWaterMark: 64 * 1024 })) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
    length += bytes.length;
    if (length > limit) throw new Error("File grew beyond limit");
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}

/** Pure admission: bounded local reads only, never install, network or tool execution. */
export async function validateAppBundle(manifestPath: string): Promise<CheckedBundle | FailedBundle> {
  let file: string, raw: unknown;
  try {
    file = await realpath(resolve(manifestPath));
    raw = JSON.parse((await readBounded(file, MANIFEST_LIMIT)).toString("utf8"));
  } catch {
    return { ok: false, issues: [{ path: "manifest", message: "Cannot read a bounded regular JSON manifest" }] };
  }
  const definition = validateAppManifest(raw);
  if (!definition.ok) return definition;
  const root = dirname(file);
  const issues: AppValidationIssue[] = [];
  let totalBytes = 0;
  for (const asset of definition.manifest.assets) {
    const path = `assets.${asset.id}`;
    try {
      const absolute = await realpath(resolve(root, asset.path));
      const contained = relative(root, absolute);
      if (isAbsolute(contained) || contained === ".." || contained.startsWith("../") || contained.startsWith("..\\")) {
        issues.push({ path, message: "Asset resolves outside its bundle" });
        continue;
      }
      const bytes = await readBounded(absolute, Math.min(ASSET_LIMIT, BUNDLE_LIMIT - totalBytes));
      totalBytes += bytes.length;
      if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) issues.push({ path, message: "Asset content does not match declared SHA-256" });
    } catch {
      issues.push({ path, message: "Cannot read a contained, bounded regular asset" });
    }
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true, manifest: definition.manifest,
    digest: createHash("sha256").update(canonicalAppJson(definition.manifest)).digest("hex"),
  };
}

export async function checkAppUpdate(previousPath: string, next: CheckedBundle): Promise<AppValidationIssue[]> {
  const previous = await validateAppBundle(previousPath);
  if (!previous.ok) return previous.issues.map(issue => ({ ...issue, path: `previous.${issue.path}` }));
  return validateAppVersionChange(previous.manifest, next.manifest);
}
