#!/usr/bin/env node
// Local-only client. The Desktop connection file contains a secret: never publish it.
import { lstat, readFile } from "node:fs/promises";
import { request } from "node:http";
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--connection" || args[2] !== "--request") {
  console.error("Usage: node scripts/mico-local.mjs --connection <private-connection.json> --request <request.json>"); process.exit(2);
}
async function bounded(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error("Invalid input file");
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error("Invalid input file"); }
}
try {
  const config = await bounded(args[1]), payload = await bounded(args[3]);
  const url = new URL(config.endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/v1/action" || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error("Invalid local connection");
  if (typeof payload.nonce !== "string" || !payload.nonce) throw new Error("Set a unique nonce in request.json; retain it if retrying the same request.");
  await new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", timeout: 20000,
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" } }, res => {
      const chunks = []; let size = 0;
      res.on("data", chunk => { size += chunk.length; if (size > 65536) { res.destroy(); reject(new Error("Oversized response")); } else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`Local script refused (${res.statusCode}). No automatic retry was made.`));
        process.stdout.write(Buffer.concat(chunks).toString("utf8") + "\n"); resolve();
      });
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("Request timed out; check the chat before retrying.")));
    req.end(JSON.stringify(payload));
  });
} catch (error) { console.error(error instanceof Error ? error.message : "Local script failed"); process.exitCode = 1; }
