import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configuration, operation, parseGate, replace, revision } from "./route-state.mjs";

const [action, directory, id, expected] = process.argv.slice(2);
if (process.argv.length !== 6 || !["hold", "release"].includes(action) || !directory
    || !operation.test(id ?? "") || !revision.test(expected ?? "")) {
  throw new Error("invalid ingress hold request");
}
const path = join(directory, "gate.json");
const gate = parseGate(readFileSync(path, "utf8"));
if (existsSync(join(directory, "pending.json"))
    || readFileSync(join(directory, "active.conf"), "utf8") !== configuration(expected)
    || (gate.hold !== null && gate.hold !== id)
    || (gate.hold === null && gate.revision !== expected)) {
  throw new Error("ingress transition or revision mismatch");
}
const next = { revision: expected, hold: action === "hold" ? id : null };
if (action === "hold" && gate.revision !== expected) throw new Error("ingress hold revision changed");
if (gate.revision !== next.revision || gate.hold !== next.hold) replace(path, JSON.stringify(next) + "\n");
console.log(JSON.stringify(next));
