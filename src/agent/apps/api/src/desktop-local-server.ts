import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Socket } from "node:net";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { InMemoryRealtimeFanout, migrateJobQueue } from "@rakazo/adapters";
import { provisionRuntimeRole } from "@rakazo/db";
import EmbeddedPostgres from "embedded-postgres";
import { createApp } from "./app.js";

export interface DesktopLocalConfig {
  dataDir: string;
  webRoot: string;
  migrationsRoot: string;
  port: number;
  token: string;
  build: string;
  /** Source preview uses the same database/auth with a separate Vite origin. */
  projectPreview?: { webOrigin: string; migrationConfig: string };
  hostComputer?: { url: string; token: string };
}

export async function freeLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string")
    throw new Error("Could not allocate local database port");
  return address.port;
}

type Identity = {
  databasePassword: string;
  appPassword: string;
  authSecret: string;
  encryptionKey: string;
  screenProxySecret: string;
};
async function localIdentity(dataDir: string): Promise<Identity> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "identity.json");
  try {
    const identity = JSON.parse(await readFile(file, "utf8")) as Identity;
    if (
      !Object.values(identity).every(
        (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
      ) ||
      Object.keys(identity).length !== 5
    )
      throw new Error("Invalid local identity");
    return identity;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
    const identity = Object.fromEntries(
      ["databasePassword", "appPassword", "authSecret", "encryptionKey", "screenProxySecret"].map(
        (key) => [key, randomBytes(32).toString("hex")],
      ),
    ) as Identity;
    await writeFile(file, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
    return identity;
  }
}

async function runFile(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  await new Promise<void>((resolve, reject) =>
    execFile(
      command,
      args,
      { ...options, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const prismaCode = /\bP\d{4}\b/.exec(String(stderr))?.[0];
        const migration = /Migration name: (\w+)/.exec(String(stderr))?.[1];
        const phase = args.includes("migrate") ? "migration" : "initialization";
        reject(
          new Error(
            `Local database command failed (${phase}, exit ${error.code ?? "unknown"}${prismaCode ? `, ${prismaCode}` : ""}${migration ? `, ${migration}` : ""})`,
          ),
        );
      },
    ),
  );
}

/** Uses PostgreSQL's existing schema and RLS; no lossy conversion to a second database engine. */
export async function startDesktopLocalServer(config: DesktopLocalConfig) {
  const diagnostic = (phase: string) => {
    if (process.env.MYCELLIOS_LOCAL_SERVER_DIAGNOSTICS === "1")
      console.log(JSON.stringify({ localServerPhase: phase }));
  };
  diagnostic("configuration");
  if (!/^[a-f0-9]{64}$/.test(config.token)) throw new Error("Invalid local server token");
  if (config.projectPreview) {
    const origin = new URL(config.projectPreview.webOrigin);
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" ||
        origin.origin !== config.projectPreview.webOrigin || origin.username || origin.password)
      throw new Error("Project preview requires a loopback web origin");
  }
  const identity = await localIdentity(config.dataDir);
  const databasePort = await freeLocalPort();
  const lockFile = join(config.dataDir, "server.lock");
  let recovering = false;
  try {
    await writeFile(lockFile, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
      throw error;
    const previous = Number(await readFile(lockFile, "utf8"));
    if (!Number.isSafeInteger(previous) || previous <= 0)
      throw new Error("The local server lock is invalid");
    try {
      process.kill(previous, 0);
      throw new Error("This local profile is already running");
    } catch (check) {
      if (!(check && typeof check === "object" && "code" in check && check.code === "ESRCH"))
        throw check;
    }
    await rm(lockFile);
    await writeFile(lockFile, String(process.pid), { flag: "wx", mode: 0o600 });
    recovering = true;
  }
  const databaseDir = join(config.dataDir, "postgres");
  const postmasterFile = join(databaseDir, "postmaster.pid");
  const postgresFlags = ["-h", "127.0.0.1", "-c", "max_connections=30", "-c", "shared_buffers=32MB"];
  const postgresControl = async (...args: string[]) => {
    const require = createRequire(import.meta.resolve("embedded-postgres"));
    const binaries = (await import(
      pathToFileURL(
        require.resolve(
          `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`,
        ),
      ).href
    )) as { pg_ctl: string };
    const command = ["-D", databaseDir, ...args];
    if (process.platform === "win32") {
      // A Windows server can inherit the controller's pipes after pg_ctl has exited.
      const child = spawn(binaries.pg_ctl, command, { windowsHide: true, stdio: "ignore" });
      const [code] = await once(child, "exit");
      if (code !== 0) throw new Error(`Local PostgreSQL control failed (exit ${code ?? "unknown"})`);
    } else {
      await runFile(binaries.pg_ctl, command);
    }
  };
  const postgres = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: identity.databasePassword,
    port: databasePort,
    persistent: true,
    authMethod: "scram-sha-256",
    autoRehydrateSymlinks: true,
    onLog: () => undefined,
    onError: () => undefined,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags,
  });
  let stopApp: (() => Promise<void>) | undefined;
  let closeHttp: (() => Promise<void>) | undefined;
  let stopped = false;
  const close = async () => {
    if (stopped) return;
    stopped = true;
    await closeHttp?.().catch(() => undefined);
    await stopApp?.().catch(() => undefined);
    // Keep the profile lock if its Windows cluster cannot be stopped.
    if (process.platform === "win32") {
      if (existsSync(postmasterFile)) await postgresControl("-m", "fast", "-w", "-t", "60", "stop");
    } else {
      try {
        await postgresControl("-m", "fast", "-w", "stop");
      } catch {
        await postgres.stop();
      }
    }
    await rm(lockFile, { force: true });
  };
  try {
    if (recovering && existsSync(postmasterFile))
      await postgresControl("-m", "fast", "-w", "stop").catch(() => undefined);
    diagnostic("database-initialize");
    if (!existsSync(join(databaseDir, "PG_VERSION"))) await postgres.initialise();
    diagnostic("database-start");
    if (process.platform === "win32") {
      // pg_ctl observes server readiness independently of the native log stream.
      await postgresControl(
        "-w", "-t", "60", "-l", join(databaseDir, "server.log"),
        "-o", ["-p", String(databasePort), ...postgresFlags].join(" "), "start",
      );
    } else {
      await postgres.start();
    }
    diagnostic("database-connect");
    const client = postgres.getPgClient("postgres", "127.0.0.1");
    await client.connect();
    try {
      const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = 'rakazo'");
      if (!existing.rowCount) await client.query('CREATE DATABASE "rakazo"');
    } finally {
      await client.end();
    }
    const migrationUrl = `postgresql://postgres:${identity.databasePassword}@127.0.0.1:${databasePort}/rakazo`;
    const runtimeUrl = `postgresql://rakazo_local:${identity.appPassword}@127.0.0.1:${databasePort}/rakazo`;
    const env = {
      ...process.env,
      DATABASE_MIGRATION_URL: migrationUrl,
      DATABASE_URL: runtimeUrl,
      ELECTRON_RUN_AS_NODE: "1",
      PRISMA_HIDE_UPDATE_MESSAGE: "true",
    };
    const require = createRequire(import.meta.url);
    const prismaCli = join(dirname(require.resolve("prisma/package.json")), "build", "index.js");
    diagnostic("schema-migrations");
    await runFile(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "deploy",
        "--config",
        config.projectPreview?.migrationConfig ?? join(config.migrationsRoot, "prisma.config.mjs"),
      ],
      { env, cwd: config.migrationsRoot },
    );
    diagnostic("job-migrations");
    await migrateJobQueue(migrationUrl);
    await provisionRuntimeRole(migrationUrl, runtimeUrl);
    const origin = `http://127.0.0.1:${config.port}`;
    Object.assign(process.env, {
      NODE_ENV: config.projectPreview ? "development" : "production",
      DATABASE_URL: runtimeUrl,
      REALTIME_DATABASE_URL: runtimeUrl,
      BETTER_AUTH_SECRET: identity.authSecret,
      ENCRYPTION_KEY: identity.encryptionKey,
      CONTENT_ENCRYPTION: "on",
      SCREEN_PROXY_SECRET: identity.screenProxySecret,
      DATA_DIR: config.dataDir,
      WEB_ORIGIN: config.projectPreview?.webOrigin ?? origin,
      BETTER_AUTH_URL: config.projectPreview?.webOrigin ?? origin,
      API_URL: origin,
      API_HOST: "127.0.0.1",
      API_PORT: String(config.port),
      WAKEUP_DRIVER: config.projectPreview ? "graphile" : "memory",
      SANDBOX_PROVIDER: "none",
      MCP_ALLOW_PRIVATE_ENDPOINT: "true",
      RAKAZO_DESKTOP_STACK_TOKEN: config.token,
      RAKAZO_IMAGE_TAG: config.build,
      ...(config.hostComputer
        ? {
            SANDBOX_HOST_URL: config.hostComputer.url.replace("host.docker.internal", "127.0.0.1"),
            SANDBOX_HOST_TOKEN: config.hostComputer.token,
          }
        : {}),
    });
    diagnostic("application-create");
    const { app, stop, prisma } = await createApp(
      config.projectPreview ? {} : { realtime: new InMemoryRealtimeFanout() },
    );
    stopApp = stop;
    app.get("*", async (c, next) => {
      if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/rpc")) return c.notFound();
      return serveStatic({ root: config.webRoot })(c, next);
    });
    app.get("*", serveStatic({ path: join(config.webRoot, "index.html") }));
    const sockets = new Set<Socket>();
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      if (server.listening) resolve();
      else server.once("listening", resolve);
      server.once("error", reject);
    });
    closeHttp = async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    };
    diagnostic("ready");
    return { origin, close, prisma };
  } catch (error) {
    await close().catch(() => diagnostic("database-cleanup-failed"));
    throw error;
  }
}
