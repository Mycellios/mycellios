import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const revision = /^[a-f0-9]{40}$/;
export const operation = /^[a-f0-9]{64}$/;
export const hostname = (sha) => `coordinator-release-${sha}`;
export const configuration = (sha) => `set $coordinator_backend ${hostname(sha)}:4174;\n`;

export function parseGate(raw) {
  const gate = JSON.parse(raw);
  if (!gate || Object.keys(gate).length !== 2 || typeof gate.revision !== "string" || !revision.test(gate.revision)
      || (gate.hold !== null && (typeof gate.hold !== "string" || !operation.test(gate.hold)))) {
    throw new Error("invalid ingress gate state");
  }
  return gate;
}

export function syncDir(path) {
  const fd = openSync(dirname(path), "r");
  try { fsyncSync(fd); }
  finally { closeSync(fd); }
}

export function replace(path, content) {
  const temp = `${path}.${randomUUID()}`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  syncDir(path);
}
