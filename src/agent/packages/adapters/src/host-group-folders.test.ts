import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext } from "@mycellios/adapter-kit";
import { afterEach, expect, it } from "vitest";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { startHostComputerServer } from "./host-computer-server.js";

const named = (groupId: string, ...folders: Array<[string, string]>) => ({
  groupId,
  folders: folders.map(([folderId, label]) => ({ folderId, label })),
});

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof startHostComputerServer>>[] = [];
const id = (seed: string) => createHash("sha256").update(seed).digest("hex");
const text = (value: string) => new TextEncoder().encode(value);
const node: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) {
    expect(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)).toBe(true);
    await rm(root, { recursive: true, force: true });
  }
});

async function setup() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-group-folders-")));
  roots.push(root);
  const shared = path.join(root, "site");
  const other = path.join(root, "notes");
  await mkdir(shared);
  await mkdir(other);
  await writeFile(path.join(shared, "index.html"), "<h1>Before</h1>");
  const token = "ef".repeat(32);
  const server = await startHostComputerServer({
    root: path.join(root, "computer"),
    token,
    hostname: "127.0.0.1",
  });
  servers.push(server);
  const client = new HostComputerSandbox(`http://127.0.0.1:${server.port}`, token);
  const context = (
    botId: string,
    groupFolders?: AdapterContext["groupFolders"],
  ): AdapterContext => ({
    operationId: "group-folders",
    traceId: "group-folders",
    spaceId: "space",
    userId: "owner",
    botId,
    signal: new AbortController().signal,
    ...(groupFolders ? { groupFolders } : {}),
  });
  return { root, shared, other, server, client, context };
}

it("grants a group's folders only to the group's turns that name them, and revokes them at once", async () => {
  const { shared, other, server, client, context } = await setup();
  const siteId = id("site");
  const notesId = id("notes");
  await expect(server.grantGroupFolder("group-1", siteId, shared)).rejects.toThrow("disabled");
  server.setEnabled(true);
  await expect(
    server.grantGroupFolder("group-1", siteId, path.parse(shared).root),
  ).rejects.toThrow();
  expect(await server.grantGroupFolder("group-1", siteId, shared)).toMatchObject({
    name: "site",
    path: shared,
  });
  await server.grantGroupFolder("group-1", notesId, other);
  // Granting the same folder again is idempotent; another folder cannot reuse an id.
  await server.grantGroupFolder("group-1", siteId, shared);
  await expect(server.grantGroupFolder("group-1", siteId, other)).rejects.toThrow();

  // The label is the one the server assigned, whatever the folder is called on disk.
  const member = context("ana", named("group-1", [siteId, "site"]));
  const computer = await client.provision({ botId: "ana", homePath: "" }, member);
  const relabelled = context("ana", named("group-1", [siteId, "web"]));
  // Only ids the server names reach the run: notes is granted on the PC but not named.
  expect((await client.environment(computer, relabelled)).groupFolders).toEqual([
    { folderId: siteId, label: "web", path: shared },
  ]);
  const web = new TextDecoder().decode(
    await client.readFile(computer, "group/web/index.html", relabelled),
  );
  expect(web).toBe("<h1>Before</h1>");
  // Duplicate labels in one request reach only the first folder.
  expect(
    (
      await client.environment(
        computer,
        context("ana", named("group-1", [siteId, "x"], [notesId, "x"])),
      )
    ).groupFolders,
  ).toEqual([{ folderId: siteId, label: "x", path: shared }]);
  const environment = await client.environment(
    computer,
    context("ana", named("group-1", [siteId, "site"])),
  );
  expect(environment.groupFolders).toEqual([{ folderId: siteId, label: "site", path: shared }]);
  expect(await client.listFiles(computer, "group", member)).toEqual([
    { path: "group/site", kind: "dir", size: 0 },
  ]);
  await client.writeFile(
    computer,
    { path: "group/site/note.txt", content: text("from Ana") },
    member,
  );
  expect(await readFile(path.join(shared, "note.txt"), "utf8")).toBe("from Ana");
  expect(
    new TextDecoder().decode(await client.readFile(computer, "group/site/index.html", member)),
  ).toBe("<h1>Before</h1>");
  expect(await client.listFiles(computer, "group/site", member)).toContainEqual(
    expect.objectContaining({ path: "group/site/note.txt", kind: "file" }),
  );
  await expect(client.readFile(computer, "group/notes/x.txt", member)).rejects.toThrow(
    "not available",
  );
  await expect(
    client.writeFile(computer, { path: "group/site/../escape.txt", content: text("x") }, member),
  ).rejects.toThrow();

  // Commands may start in a shared folder.
  const events = [];
  for await (const event of client.execute(
    computer,
    {
      argv: [process.execPath, "-e", "require('node:fs').writeFileSync('built.txt','ok')"],
      cwd: "group/site",
      env: node,
      timeoutMs: 10000,
    },
    member,
  ))
    events.push(event);
  expect(events).toContainEqual({ type: "exit", code: 0 });
  expect(await readFile(path.join(shared, "built.txt"), "utf8")).toBe("ok");
  const outside = [];
  await expect(
    (async () => {
      for await (const event of client.execute(
        computer,
        { argv: [process.execPath, "-e", ""], cwd: "group/site/..", env: node, timeoutMs: 10000 },
        member,
      ))
        outside.push(event);
    })(),
  ).rejects.toThrow();

  // The native path of a folder this run may use works as a working directory too.
  const native = [];
  for await (const event of client.execute(
    computer,
    {
      argv: [process.execPath, "-e", "require('node:fs').writeFileSync('native.txt','ok')"],
      cwd: shared,
      env: node,
      timeoutMs: 10000,
    },
    member,
  ))
    native.push(event);
  expect(native).toContainEqual({ type: "exit", code: 0 });
  expect(await readFile(path.join(shared, "native.txt"), "utf8")).toBe("ok");

  // Another group, no group, or a Mico's own chat: the folder is not there.
  const otherGroup = context("ana", named("group-2", [siteId, "site"]));
  expect((await client.environment(computer, otherGroup)).groupFolders).toEqual([]);
  await expect(client.readFile(computer, "group/site/index.html", otherGroup)).rejects.toThrow(
    "not available",
  );
  expect((await client.environment(computer, context("ana"))).groupFolders).toBeUndefined();
  await expect(
    client.readFile(computer, "group/site/index.html", context("ana")),
  ).rejects.toThrow();

  // The server stops naming a removed folder: the next request no longer reaches it.
  await expect(
    client.readFile(computer, "group/site/index.html", context("ana", named("group-1"))),
  ).rejects.toThrow("not available");
  // Removing it on the PC revokes it even for a request that still names it.
  server.revokeGroupFolder("group-1", siteId);
  await expect(client.readFile(computer, "group/site/index.html", member)).rejects.toThrow(
    "not available",
  );
  expect(server.groupFolders("group-1").map((grant) => grant.folderId)).toEqual([notesId]);
  // Revoking PC access clears every group grant.
  await server.grantGroupFolder("group-1", siteId, shared);
  server.clearProjects();
  expect(server.groupFolders("group-1")).toEqual([]);
}, 30000);

it("lands an edit only over the content it was made from", async () => {
  const { shared, server, client, context } = await setup();
  const siteId = id("site");
  server.setEnabled(true);
  await server.grantGroupFolder("group-1", siteId, shared);
  const ana = context("ana", named("group-1", [siteId, "site"]));
  const ben = context("ben", named("group-1", [siteId, "site"]));
  const anaComputer = await client.provision({ botId: "ana", homePath: "" }, ana);
  const benComputer = await client.provision({ botId: "ben", homePath: "" }, ben);
  const before = createHash("sha256").update("<h1>Before</h1>").digest("hex");
  await client.writeFile(
    anaComputer,
    { path: "group/site/index.html", content: text("<h1>Ana</h1>"), expectedSha256: before },
    ana,
  );
  await expect(
    client.writeFile(
      benComputer,
      { path: "group/site/index.html", content: text("<h1>Ben</h1>"), expectedSha256: before },
      ben,
    ),
  ).rejects.toThrow("Another Mico changed this file");
  expect(await readFile(path.join(shared, "index.html"), "utf8")).toBe("<h1>Ana</h1>");
  const current = createHash("sha256").update("<h1>Ana</h1>").digest("hex");
  await client.writeFile(
    benComputer,
    {
      path: "group/site/index.html",
      content: text("<h1>Ana and Ben</h1>"),
      expectedSha256: current,
    },
    ben,
  );
  expect(await readFile(path.join(shared, "index.html"), "utf8")).toBe("<h1>Ana and Ben</h1>");
  // Two edits made from the same content at the same time: exactly one lands.
  const results = await Promise.allSettled(
    ["one", "two"].map((name) =>
      client.writeFile(
        anaComputer,
        {
          path: "group/site/index.html",
          content: text(name),
          expectedSha256: createHash("sha256").update("<h1>Ana and Ben</h1>").digest("hex"),
        },
        ana,
      ),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

  // Different spellings of one file on a case-insensitive file system (Windows, macOS) take
  // turns, so only one edit made from the same content lands. Where names are case-sensitive
  // the second spelling is another, missing file, so its edit is refused as well.
  const landed = await readFile(path.join(shared, "index.html"), "utf8");
  const spelled = await Promise.allSettled(
    ["group/site/index.html", "group/site/INDEX.HTML"].map((file, index) =>
      client.writeFile(
        anaComputer,
        {
          path: file,
          content: text(`spelling ${index}`),
          expectedSha256: createHash("sha256").update(landed).digest("hex"),
        },
        ana,
      ),
    ),
  );
  expect(spelled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
}, 30000);

it("withdraws grants of folders the server no longer has", async () => {
  const { shared, other, server } = await setup();
  server.setEnabled(true);
  await server.grantGroupFolder("group-1", id("site"), shared);
  await server.grantGroupFolder("group-1", id("notes"), other);
  server.pruneGroupFolders("group-1", [id("notes")]);
  expect(server.groupFolders("group-1").map((grant) => grant.folderId)).toEqual([id("notes")]);
  server.pruneGroupFolders("group-1", []);
  expect(server.groupFolders("group-1")).toEqual([]);
});

it("runs a command in a shared folder outside the Mico's allowed roots only when that command is granted it", async () => {
  // The host's own roots are the OS home; a shared folder can live elsewhere (another drive,
  // /srv, /tmp). Here no extra roots are configured, so the folder is outside on every platform.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-group-roots-")));
  roots.push(root);
  const shared = await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-group-shared-")));
  roots.push(shared);
  const desktop = new DesktopSandboxProvider({ root });
  const context = {
    operationId: "roots",
    traceId: "roots",
    spaceId: "s",
    userId: "u",
    signal: new AbortController().signal,
  };
  const computer = await desktop.provision({ botId: "ana", homePath: "" }, context);
  const command = {
    argv: [process.execPath, "-e", "require('node:fs').writeFileSync('ran.txt','ok')"],
    cwd: shared,
    env: node,
    timeoutMs: 10000,
  };
  const refused = [];
  for await (const event of desktop.execute(computer, command, context)) refused.push(event);
  expect(refused).toContainEqual({ type: "exit", code: 1 });
  const granted = [];
  for await (const event of desktop.execute(computer, command, context, { grantedRoots: [shared] }))
    granted.push(event);
  expect(granted).toContainEqual({ type: "exit", code: 0 });
  expect(await readFile(path.join(shared, "ran.txt"), "utf8")).toBe("ok");
  // A grant for one folder does not reach its parent.
  const parent = [];
  for await (const event of desktop.execute(
    computer,
    { ...command, cwd: path.dirname(shared) },
    context,
    { grantedRoots: [shared] },
  ))
    parent.push(event);
  expect(parent).toContainEqual({ type: "exit", code: 1 });
}, 30000);

it("refuses a ninth folder for one group", async () => {
  const { root, server } = await setup();
  server.setEnabled(true);
  for (let index = 0; index < 8; index++) {
    const folder = path.join(root, `folder-${index}`);
    await mkdir(folder);
    await server.grantGroupFolder("group-1", id(`f${index}`), folder);
  }
  const ninth = path.join(root, "folder-9");
  await mkdir(ninth);
  await expect(server.grantGroupFolder("group-1", id("f9"), ninth)).rejects.toThrow("up to 8");
  await server.grantGroupFolder("group-2", id("f9"), ninth);
});
