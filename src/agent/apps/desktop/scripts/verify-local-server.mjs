// Run inside the required build scheduler. The app and database use a disposable profile.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Place the runtime outside the checkout so missing dependencies cannot resolve
// from development node_modules. Hard links avoid copying large read-only binaries.
async function portableCopy(from, to, root = from) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isSymbolicLink()) {
      const destination = await readlink(source);
      const inside = relative(root, resolve(dirname(source), destination));
      if (isAbsolute(destination) || inside === ".." || inside.startsWith(`..${sep}`))
        throw new Error("The packaged runtime contains a non-portable filesystem link");
      await symlink(destination, target);
    } else if (entry.isDirectory()) await portableCopy(source, target, root);
    else await link(source, target).catch(() => copyFile(source, target));
  }
}

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2)
  options.set(process.argv[i], resolve(process.argv[i + 1]));
const serverRoot = options.get("--server-root") ?? join(desktop, "local-server");
const webRoot = options.get("--web-root") ?? resolve(desktop, "../web/dist");
const require = createRequire(join(desktop, "package.json"));
const electron = require("electron");
const profile = await mkdtemp(join(tmpdir(), "rakazo-electron-local-"));
if (
  !resolve(profile).startsWith(resolve(tmpdir()) + sep) ||
  !profile.includes("rakazo-electron-local-")
)
  throw new Error("Unexpected fixture cleanup path");
const relocatedServer = join(profile, "server");
const relocatedWeb = join(profile, "web");
try {
  await portableCopy(serverRoot, relocatedServer);
  await portableCopy(webRoot, relocatedWeb);
} catch (error) {
  await rm(profile, { recursive: true, force: true });
  throw error;
}
const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const configFile = join(profile, "server.json");
await writeFile(
  configFile,
  JSON.stringify({
    dataDir: join(profile, "data"),
    webRoot: relocatedWeb,
    migrationsRoot: relocatedServer,
    port,
    token: randomBytes(32).toString("hex"),
    build: "fixture",
  }),
);
const env = Object.fromEntries(
  [
    "PATH",
    "Path",
    "USERPROFILE",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "PATHEXT",
  ].flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])),
);
Object.assign(env, {
  NODE_ENV: "production",
  AGENT_RUNTIME: "scripted",
  CLOUD_AGENT_PROVIDER: "emulator",
  MEDIA_GENERATION_PROVIDER: "disabled",
  ANALYTICS_PROVIDER: "none",
  LOG_LEVEL: "off",
});
const child = spawn(
  electron,
  [
    join(desktop, "scripts/fixtures/local-server-electron.cjs"),
    configFile,
    join(relocatedServer, "dist/desktop-local-entry.js"),
    profile,
  ],
  { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let stdout = "";
child.stdout.on("data", (data) => {
  stdout = (stdout + data).slice(-4000);
});
child.stderr.resume();
const timer = setTimeout(() => {
  if (process.platform === "win32")
    execFile(
      join(process.env.SystemRoot, "System32/taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      () => {},
    );
  else child.kill("SIGKILL");
}, 210000);
try {
  const code = await new Promise((r, reject) => {
    child.once("error", reject);
    child.once("close", r);
  });
  if (code !== 0 || !stdout.includes('"electronUtility":true'))
    throw new Error(`Electron local server verification failed: ${stdout.trim()}`);
  console.log(stdout.trim());
  console.log(JSON.stringify({ portableProfileCopy: true }));
} finally {
  clearTimeout(timer);
  await rm(profile, { recursive: true, force: true });
}
