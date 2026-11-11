import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishDesktopDownloads } from "../scripts/publish-desktop-downloads.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const version = "0.3.41";
const windows = "0.3.41";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const rpmBytes = new Uint8Array(Buffer.from("rpm-payload"));
const debBytes = new Uint8Array(Buffer.from("deb-payload"));
const sourceBytes = new Uint8Array(Buffer.from("source-payload"));

function catalog(withFedora: boolean) {
  const path = (release: string, name: string) => `/downloads/desktop/releases/${release}/${name}`;
  const windowsName = `Mycellios-Desktop-${windows}-windows-x64-pilot.exe`;
  const debName = "Mycellios-Desktop-0.3.32-linux-x64-pilot.deb";
  return {
    schema: "mycellios-desktop-downloads/1",
    version: windows,
    runtimeVersion: "0.2.95",
    channel: "preview",
    automaticUpdates: false,
    packages: [
      { id: "windows-x64", format: "EXE", version: windows, fileName: windowsName, path: path(windows, windowsName), bytes: 10, sha256: "a".repeat(64) },
      { id: "linux-x64", format: "DEB", version: "0.3.32", fileName: debName, path: path("0.3.32", debName), bytes: 20, sha256: "b".repeat(64),
        source: { path: path("0.3.32", "Mycellios-Desktop-0.3.32-source-e25994ba.tar.gz"), sha256: "c".repeat(64) } },
    ],
    source: { path: path(windows, `Mycellios-Desktop-${windows}-source-0321cc8e.tar.gz`), sha256: "d".repeat(64) },
    ...(withFedora ? {
      fedora: { id: "fedora-x64", format: "RPM", version: "0.3.32", fileName: "Mycellios-Desktop-0.3.32-fedora-x86_64.rpm",
        path: path("0.3.32", "Mycellios-Desktop-0.3.32-fedora-x86_64.rpm"), bytes: 30, sha256: "e".repeat(64),
        source: { path: path("0.3.32", "Mycellios-Desktop-0.3.32-source-e25994ba.tar.gz"), sha256: "c".repeat(64) } },
    } : {}),
  };
}

async function fixture(options: { deb?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "desktop-publish-")); temporary.push(root);
  const releaseDirectory = join(root, "release");
  const artifacts = join(root, "artifacts");
  await mkdir(join(releaseDirectory, "releases", windows), { recursive: true });
  await mkdir(join(artifacts, "fedora"), { recursive: true });

  const rpm = `Mycellios-Desktop-${version}-fedora-x86_64.rpm`;
  const source = `Mycellios-Desktop-${version}-source-0321cc8e.tar.gz`;
  await writeFile(join(artifacts, "fedora", rpm), rpmBytes);
  await writeFile(join(artifacts, source), sourceBytes);
  if (options.deb) await writeFile(join(artifacts, `Mycellios-Desktop-${version}-linux-x64-pilot.deb`), debBytes);

  for (const name of ["catalog.json", "catalog-macos.json", "catalog-macos-all.json"]) {
    await writeFile(join(releaseDirectory, name), `${JSON.stringify(catalog(name === "catalog-macos-all.json"), null, 2)}\n`);
  }
  return { root, releaseDirectory, artifacts, rpm, source };
}

describe("publishing Linux packages into a staged Desktop release", () => {
  it("stages the RPM with the source and only adds the Fedora entry", async () => {
    const { releaseDirectory, artifacts, rpm, source } = await fixture();
    const before = JSON.parse(await readFile(join(releaseDirectory, "catalog.json"), "utf8"));
    const result = await publishDesktopDownloads({ releaseDirectory, artifacts, version });

    expect(result.packages).toEqual([{ id: "fedora-x64", fileName: rpm, bytes: rpmBytes.byteLength, sha256: digest(rpmBytes) }]);
    expect(result.catalogs).toEqual(["catalog-macos-all.json"]);
    expect(await readdir(join(releaseDirectory, "releases", version))).toEqual([rpm, source].sort());

    const extended = JSON.parse(await readFile(join(releaseDirectory, "catalog-macos-all.json"), "utf8"));
    expect(extended.fedora).toMatchObject({ version, fileName: rpm, bytes: rpmBytes.byteLength, sha256: digest(rpmBytes) });
    expect(extended.fedora.source).toEqual({ path: `/downloads/desktop/releases/${version}/${source}`, sha256: digest(sourceBytes) });
    // Windows and the old Linux entry are untouched.
    expect(extended.packages.map((item: { id: string }) => item.id)).toEqual(before.packages.map((item: { id: string }) => item.id));
    expect(JSON.parse(await readFile(join(releaseDirectory, "catalog.json"), "utf8"))).toEqual(before);
  });

  it("publishes the DEB as linux-x64 in every catalog when asked", async () => {
    const { releaseDirectory, artifacts } = await fixture({ deb: true });
    const result = await publishDesktopDownloads({ releaseDirectory, artifacts, version, deb: true });
    expect(result.packages.map(item => item.id)).toEqual(["fedora-x64", "linux-x64"]);
    expect(result.catalogs).toEqual([...(["catalog.json", "catalog-macos.json", "catalog-macos-all.json"])]);
    for (const name of result.catalogs) {
      const parsed = JSON.parse(await readFile(join(releaseDirectory, name), "utf8"));
      const linux = parsed.packages.find((item: { id: string }) => item.id === "linux-x64");
      expect(linux).toMatchObject({ version, bytes: debBytes.byteLength, sha256: digest(debBytes) });
      expect(linux.source.path).toBe(`/downloads/desktop/releases/${version}/Mycellios-Desktop-${version}-source-0321cc8e.tar.gz`);
    }
  });

  it("is idempotent and refuses to replace a published file with different content", async () => {
    const { releaseDirectory, artifacts, rpm } = await fixture();
    await publishDesktopDownloads({ releaseDirectory, artifacts, version });
    const first = await readFile(join(releaseDirectory, "catalog-macos-all.json"), "utf8");
    await publishDesktopDownloads({ releaseDirectory, artifacts, version });
    expect(await readFile(join(releaseDirectory, "catalog-macos-all.json"), "utf8")).toBe(first);

    await writeFile(join(artifacts, "fedora", rpm), new Uint8Array(Buffer.from("tampered")));
    await expect(publishDesktopDownloads({ releaseDirectory, artifacts, version })).rejects.toThrow(/immutable/);
  });

  it("rejects a catalog that is missing, invalid or for another version", async () => {
    const missing = await fixture();
    await rm(join(missing.releaseDirectory, "catalog-macos-all.json"));
    await expect(publishDesktopDownloads({ ...missing, version })).rejects.toThrow(/missing from the staged release/);

    const other = await fixture();
    await writeFile(join(other.artifacts, "Mycellios-Desktop-0.3.42-source-abcd.tar.gz"), sourceBytes);
    await expect(publishDesktopDownloads({ ...other, version: "0.3.42" })).rejects.toThrow(/Fedora RPM/);

    const invalid = await fixture();
    await writeFile(join(invalid.releaseDirectory, "catalog.json"), "{\"schema\":\"other\"}\n");
    await expect(publishDesktopDownloads({ ...invalid, version })).rejects.toThrow(/not a valid Desktop download catalog/);
  });

  it("does not write anything in a dry run", async () => {
    const { releaseDirectory, artifacts } = await fixture();
    const before = await readFile(join(releaseDirectory, "catalog-macos-all.json"), "utf8");
    const result = await publishDesktopDownloads({ releaseDirectory, artifacts, version, dryRun: true });
    expect(result.packages).toHaveLength(1);
    expect(await readFile(join(releaseDirectory, "catalog-macos-all.json"), "utf8")).toBe(before);
    expect(await readdir(join(releaseDirectory, "releases", version))).toEqual([]);
  });
});
