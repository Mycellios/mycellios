import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDesktopDownloadCatalog, type DesktopDownloadCatalog } from "../src/contracts/desktop-downloads.js";

/**
 * Adds Linux packages to a staged Desktop release without rewriting the other
 * platforms. The deploy that copies the Windows installer owns the catalogs and
 * the release directory; this runs right after it, before the swap.
 */

const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const CATALOGS = ["catalog.json", "catalog-macos.json", "catalog-macos-all.json"] as const;
/** Only the extended catalog carries the optional Fedora entry. */
const FULL_CATALOG = "catalog-macos-all.json";

export interface PublishInput {
  /** Staged `desktop-downloads` directory for this release. */
  releaseDirectory: string;
  /** Directory holding the artifacts produced by the Linux release workflow. */
  artifacts: string;
  version: string;
  /** Also publish the DEB as `linux-x64`, which reaches Debian and Ubuntu. */
  deb?: boolean;
  dryRun?: boolean;
}

export interface PublishedPackage {
  id: "fedora-x64" | "linux-x64";
  fileName: string;
  bytes: number;
  sha256: string;
}

export interface PublishResult {
  version: string;
  staged: string[];
  packages: PublishedPackage[];
  catalogs: string[];
}

interface Candidate extends PublishedPackage {
  file: string;
  source: { path: string; sha256: string };
}

function fail(message: string): never {
  throw new Error(message);
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function escaped(version: string): string {
  return version.replaceAll(".", "\\.");
}

async function single(directory: string, pattern: RegExp, hint: string): Promise<string> {
  const names = (await readdir(directory).catch(() => [] as string[]))
    .filter(name => pattern.test(name))
    .sort();
  if (names.length !== 1) fail(`${hint}: expected exactly one file in ${directory}, found ${names.length}`);
  return path.join(directory, names[0]!);
}

async function measure(file: string, id: PublishedPackage["id"], source: Candidate["source"]): Promise<Candidate> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) fail(`${path.basename(file)} must be a regular file`);
  return { id, file, fileName: path.basename(file), bytes: info.size, sha256: await sha256(file), source };
}

/** Packages first: a catalog must never advertise a file that is not staged. */
async function stage(releases: string, candidate: Candidate): Promise<void> {
  const target = path.join(releases, candidate.fileName);
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || await sha256(target) !== candidate.sha256) {
      fail(`${candidate.fileName} already exists with different content; published files are immutable`);
    }
    return;
  }
  await copyFile(candidate.file, target);
}

function releasePath(release: string, fileName: string): string {
  return `/downloads/desktop/releases/${release}/${fileName}`;
}

function fedoraEntry(candidate: Candidate, release: string): NonNullable<DesktopDownloadCatalog["fedora"]> {
  return {
    id: "fedora-x64",
    format: "RPM",
    version: release,
    fileName: candidate.fileName,
    path: releasePath(release, candidate.fileName),
    bytes: candidate.bytes,
    sha256: candidate.sha256,
    source: candidate.source,
  };
}

function debEntry(candidate: Candidate, release: string): DesktopDownloadCatalog["packages"][number] {
  return {
    id: "linux-x64",
    format: "DEB",
    version: release,
    fileName: candidate.fileName,
    path: releasePath(release, candidate.fileName),
    bytes: candidate.bytes,
    sha256: candidate.sha256,
    source: candidate.source,
  };
}

function mergeCatalog(catalog: DesktopDownloadCatalog, candidates: Candidate[], release: string): DesktopDownloadCatalog {
  const next: DesktopDownloadCatalog = { ...catalog, packages: catalog.packages.map(item => ({ ...item })) };
  for (const candidate of candidates) {
    if (candidate.id === "fedora-x64") {
      next.fedora = fedoraEntry(candidate, release);
      continue;
    }
    const index = next.packages.findIndex(item => item.id === "linux-x64");
    if (index < 0) fail("catalog has no linux-x64 entry to update");
    next.packages[index] = debEntry(candidate, release);
  }
  return next;
}

export async function publishDesktopDownloads(input: PublishInput): Promise<PublishResult> {
  const release = input.version;
  if (!VERSION.test(release)) fail(`invalid version: ${release}`);

  const rpm = await single(path.join(input.artifacts, "fedora"), new RegExp(`^Mycellios-Desktop-${escaped(release)}-fedora-x86_64\\.rpm$`), "Fedora RPM");
  const sourceFile = await single(input.artifacts, new RegExp(`^Mycellios-Desktop-${escaped(release)}-source-[a-f0-9]+\\.tar\\.gz$`), "source archive");
  const deb = input.deb
    ? await single(input.artifacts, new RegExp(`^Mycellios-Desktop-${escaped(release)}-linux-x64-pilot\\.deb$`), "Linux DEB")
    : null;

  const sourceInfo = await lstat(sourceFile);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) fail("source archive must be a regular file");
  const source = { path: `/downloads/desktop/releases/${release}/${path.basename(sourceFile)}`, sha256: await sha256(sourceFile) };

  const candidates = [await measure(rpm, "fedora-x64", source)];
  if (deb) candidates.push(await measure(deb, "linux-x64", source));
  const staged = [...candidates.map(candidate => candidate.fileName), path.basename(sourceFile)];

  const releases = path.join(input.releaseDirectory, "releases", release);
  if (!input.dryRun) {
    await mkdir(releases, { recursive: true });
    await copyFile(sourceFile, path.join(releases, path.basename(sourceFile)));
    for (const candidate of candidates) await stage(releases, candidate);
  }

  const catalogs: string[] = [];
  for (const name of CATALOGS) {
    const file = path.join(input.releaseDirectory, name);
    const parsed: unknown = JSON.parse(await readFile(file, "utf8").catch(() => fail(`${name} is missing from the staged release`)));
    if (!isDesktopDownloadCatalog(parsed)) fail(`${name} is not a valid Desktop download catalog`);
    // Fedora lives only in the extended catalog; the DEB is advertised in all three.
    const scoped = name === FULL_CATALOG ? candidates : candidates.filter(candidate => candidate.id === "linux-x64");
    if (!scoped.length) continue;
    const next = mergeCatalog(parsed, scoped, release);
    if (!isDesktopDownloadCatalog(next)) fail(`${name} was rejected after merging ${scoped.map(item => item.id).join(", ")}`);
    if (!input.dryRun) {
      const temporary = `${file}.new`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
      await rename(temporary, file);
    }
    catalogs.push(name);
  }

  return {
    version: release,
    staged,
    packages: candidates.map(({ id, fileName, bytes, sha256: digest }) => ({ id, fileName, bytes, sha256: digest })),
    catalogs,
  };
}

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? undefined : argv[index + 1];
}

async function main(): Promise<void> {
  const releaseDirectory = argument(process.argv, "release-dir");
  const artifacts = argument(process.argv, "artifacts");
  const version = argument(process.argv, "version");
  if (!releaseDirectory || !artifacts || !version) {
    fail("usage: tsx scripts/publish-desktop-downloads.ts --release-dir <dir> --artifacts <dir> --version <x.y.z> [--deb] [--dry-run]");
  }
  console.log(JSON.stringify(await publishDesktopDownloads({
    releaseDirectory,
    artifacts,
    version,
    deb: process.argv.includes("--deb"),
    dryRun: process.argv.includes("--dry-run"),
  }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
