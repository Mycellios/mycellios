#!/usr/bin/env node
// Fails when a server bundle imports a dependency file the image does not contain. The bundles
// (scripts/build-server.mjs) keep node_modules external as relative paths resolved in the
// build stage, which has every dependency; the runtime stage installs fewer, so each of those
// paths must still exist there. Dynamic imports count too: they may only run much later.
//
// Usage: check-runtime-externals.mjs DIST_DIR...
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const directories = process.argv.slice(2);
if (directories.length === 0) throw new Error("Usage: check-runtime-externals.mjs DIST_DIR...");

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'])(\.{1,2}\/[^"'\n]*\/node_modules\/[^"'\n]*)\1/g;

function* scripts(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* scripts(file);
    else if (/\.[cm]?js$/.test(entry.name)) yield file;
  }
}

const missing = new Set();
let checked = 0;
for (const directory of directories) {
  for (const file of scripts(path.resolve(directory))) {
    for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      checked += 1;
      const target = path.resolve(path.dirname(file), match[2]);
      if (!existsSync(target)) missing.add(`${path.relative(process.cwd(), file)} -> ${match[2]}`);
    }
  }
}

if (checked === 0) throw new Error("No external dependency imports found; the bundle layout changed.");
if (missing.size > 0) {
  process.stderr.write(`Server bundles import files the image does not install:\n${[...missing].sort().join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`All ${checked} external dependency imports of the server bundles resolve.\n`);
