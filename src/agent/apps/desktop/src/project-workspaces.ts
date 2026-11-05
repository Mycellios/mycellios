import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  // Worktree creation must not execute repository hooks, helpers or shell strings.
  const { stdout } = await exec("git", ["-c", `core.hooksPath=${process.execPath}`, "-c", "core.fsmonitor=false", ...(process.platform === "win32" ? ["-c", "core.longpaths=true"] : []), "-C", cwd, ...args], {
    windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  });
  return stdout.trim();
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Native-only, owner-scoped repository choices. No path is accepted from IPC. */
export class ProjectWorkspaces {
  private pending = new Map<string, Promise<string | null>>();
  private projects = new Map<string, Promise<unknown>>();
  constructor(private storage: string) {}
  prepare(scope: string, projectId: string, threadId: string, choose: () => Promise<string | null>, validate: () => Promise<void>) {
    const key = digest([scope, projectId, threadId]);
    let pending = this.pending.get(key);
    if (!pending) {
      const project = digest([scope, projectId]);
      const prior = this.projects.get(project) ?? Promise.resolve();
      pending = prior.catch(() => undefined).then(() => this.open(scope, projectId, threadId, choose, validate)).finally(() => {
        this.pending.delete(key);
        if (this.projects.get(project) === pending) this.projects.delete(project);
      });
      this.projects.set(project, pending);
      this.pending.set(key, pending);
    }
    return pending;
  }
  private async open(scope: string, projectId: string, threadId: string, choose: () => Promise<string | null>, validate: () => Promise<void>) {
    await validate();
    const directory = path.join(this.storage, digest([scope, projectId]));
    await mkdir(directory, { recursive: true });
    const grant = path.join(directory, "repository.json");
    let source: string | undefined;
    const saved = await readPrivateFile(grant, 16384);
    if (saved) {
      const row = JSON.parse(saved) as { root: string };
      source = await realpath(row.root);
    } else {
      const picked = await choose();
      if (!picked) return null;
      await validate();
      source = await realpath(picked);
      if (source === path.parse(source).root || source === await realpath(homedir()))
        throw new Error("Choose a project folder, rather than your entire computer.");
      if (await git(source, "rev-parse", "--show-toplevel").then(realpath) !== source)
        throw new Error("Choose the root folder of a Git project.");
      await git(source, "rev-parse", "--verify", "HEAD");
      await validate();
      await writePrivateFile(grant, JSON.stringify({ root: source }));
    }
    // Git verifies ownership and repository validity; a stale native choice is not adopted.
    const common = await realpath(await git(source, "rev-parse", "--path-format=absolute", "--git-common-dir"));
    // Git for Windows also bounds its internal .git/worktrees/<basename> path.
    // Retain existing full-hash worktrees, but keep new basenames at 128 bits.
    const legacy = path.join(directory, digest(threadId));
    const home = await readPrivateFile(legacy + ".json", 16384) ? legacy : path.join(directory, digest(threadId).slice(0, 32));
    const receipt = home + ".json";
    const existing = await readPrivateFile(receipt, 16384);
    if (!existing) {
      if (await stat(home).then(() => true, e => { if (e.code === "ENOENT") return false; throw e; }))
        throw new Error("An unverified conversation folder already exists. Choose a new conversation.");
      await validate();
      await git(source, "worktree", "add", "--detach", home, "HEAD");
      await writePrivateFile(receipt, JSON.stringify({ common, threadId }));
    } else {
      const row = JSON.parse(existing) as { common: string; threadId: string };
      const actual = await realpath(await git(home, "rev-parse", "--path-format=absolute", "--git-common-dir"));
      if (row.threadId !== threadId || row.common !== common || actual !== common)
        throw new Error("The conversation worktree no longer matches this project.");
    }
    await validate();
    return realpath(home);
  }
}
