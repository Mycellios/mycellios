#!/usr/bin/env node
// Copies only the npm inputs of the repository root and the Agent workspace (package.json files,
// lockfiles and .npmrc) from a build context into a separate tree, for the dependency stages of
// infra/compose/Dockerfile. Those stages are cached by the content of this tree, so it leaves
// out what npm ci --ignore-scripts does not read: package scripts, and the version of the root
// and of each workspace (a Desktop release bumps its version on every release). Dependencies,
// overrides, engines and the resolved tree stay exactly as locked.
//
// Usage: image-manifests.mjs CONTEXT OUTPUT
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [context, output] = process.argv.slice(2).map((value) => value && path.resolve(value));
if (!context || !output) throw new Error("Usage: image-manifests.mjs CONTEXT OUTPUT");

const NEUTRAL_VERSION = "0.0.0";
const written = [];

function write(relative, contents) {
  const target = path.join(output, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  written.push(relative);
}

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(context, relative), "utf8"));
}

function manifest(relative) {
  const { scripts: _scripts, version: _version, ...rest } = readJson(relative);
  write(relative, `${JSON.stringify({ ...rest, version: NEUTRAL_VERSION }, null, 2)}\n`);
  return rest;
}

function lockfile(relative) {
  const lock = readJson(relative);
  if ("version" in lock) lock.version = NEUTRAL_VERSION;
  // Keys outside node_modules are the root ("") and the workspace folders.
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.split("/").includes("node_modules") && "version" in entry) entry.version = NEUTRAL_VERSION;
  }
  write(relative, `${JSON.stringify(lock, null, 2)}\n`);
}

function copy(relative) {
  if (!existsSync(path.join(context, relative))) return;
  const target = path.join(output, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(context, relative), target);
  written.push(relative);
}

// Workspace patterns here are folders or folder/* (npm also accepts richer globs; refuse them).
function workspaceFolders(root, patterns) {
  const folders = [];
  for (const pattern of patterns) {
    if (/[*?[\]{}!]/.test(pattern.replace(/\/\*$/, ""))) throw new Error(`Unsupported workspace pattern: ${pattern}`);
    if (!pattern.endsWith("/*")) {
      folders.push(path.posix.join(root, pattern));
      continue;
    }
    const parent = path.posix.join(root, pattern.slice(0, -2));
    for (const entry of readdirSync(path.join(context, parent), { withFileTypes: true })) {
      const folder = path.posix.join(parent, entry.name);
      if (entry.isDirectory() && existsSync(path.join(context, folder, "package.json"))) folders.push(folder);
    }
  }
  return folders.sort();
}

for (const root of ["", "src/agent"]) {
  const declared = manifest(path.posix.join(root, "package.json"));
  lockfile(path.posix.join(root, "package-lock.json"));
  copy(path.posix.join(root, ".npmrc"));
  for (const folder of workspaceFolders(root, declared.workspaces ?? [])) manifest(path.posix.join(folder, "package.json"));
}

process.stdout.write(`Copied ${written.length} npm inputs for the dependency stages.\n`);
