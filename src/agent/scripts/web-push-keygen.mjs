import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

// Server-side operator utility. Never emit the private key to stdout or a web asset.
const require = createRequire(new URL("../packages/adapters/package.json", import.meta.url));
const { generateVAPIDKeys } = require("web-push");
const target = process.argv[2];
if (!target || !path.isAbsolute(target)) throw new Error("Supply an absolute private deployment-secret file path.");
const keys = generateVAPIDKeys();
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `WEB_PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}\nWEB_PUSH_SUBJECT=\n`, { flag: "wx", mode: 0o600 });
console.log(`Created a new VAPID identity in ${target}. Set WEB_PUSH_SUBJECT and protect this file with the deployment account's ACL.`);
console.log(`Public-key fingerprint: ${createHash("sha256").update(keys.publicKey).digest("hex").slice(0, 16)}`);
