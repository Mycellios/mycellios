import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { app, BrowserWindow, ipcMain, session } from "electron";
import type { NativeDevelopmentEnvironment } from "./development-environment.js";
import { installWindowChrome } from "./window-chrome.js";
import { browserWindowOptions } from "./window-options.js";

export function isDevelopmentAsset(raw: string, server: string) {
  const url = new URL(raw),
    base = new URL(server),
    prefix = base.pathname.replace(/\/$/, "");
  const pathname = url.pathname.slice(prefix.length);
  return (
    url.origin === base.origin &&
    url.pathname.startsWith(prefix + "/") &&
    !/^\/(?:api|rpc|auth|novnc)(?:\/|$)/.test(pathname)
  );
}
export function mayOpenDevelopment(
  event: IpcMainInvokeEvent,
  stable: BrowserWindow | null,
  server: string,
) {
  const base = new URL(server),
    page = event.senderFrame ? new URL(event.senderFrame.url) : null;
  return (
    !!stable &&
    event.sender === stable.webContents &&
    event.senderFrame === event.sender.mainFrame &&
    page?.origin === base.origin &&
    page.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")
  );
}
export async function developmentWorkspace(folder: string) {
  const workspace = await realpath(folder);
  const pkg = JSON.parse(await readFile(path.join(workspace, "package.json"), "utf8"));
  if (typeof pkg.name !== "string") throw new Error("Choose a development workspace.");
  const runner = await realpath(path.join(workspace, "scripts/desktop-development.mjs"));
  if (!runner.startsWith(workspace + path.sep))
    throw new Error("Development runner escaped the selected workspace.");
  await readFile(runner);
  return workspace;
}

/** Paths and commands are native-owned; only the stable main frame may launch. */
export function installDevelopmentWindow(
  getStable: () => BrowserWindow | null,
  projects: Pick<NativeDevelopmentEnvironment, "authorize" | "development" | "state" | "connect">,
) {
  let window: BrowserWindow | null = null;
  let child: ChildProcess | undefined;
  let pending: Promise<{ opened: boolean; error?: string }> | undefined;
  const stop = () => {
    child?.kill();
    child = undefined;
  };
  let windowProject: string | undefined;
  const diagnosticFile = path.join(app.getPath("userData"), "development-window.log");
  let diagnostics = "";
  const record = (message: string) => {
    diagnostics = (diagnostics + new Date().toISOString() + " " + message + "\n").slice(-64_000);
    void writeFile(diagnosticFile, diagnostics).catch(() => undefined);
  };
  async function open(botId: unknown) {
    const project = await projects.development(botId);
    if (window && !window.isDestroyed()) {
      if (windowProject !== project.key)
        throw new Error("Close the other development project first.");
      window.show();
      window.focus();
      return { opened: true };
    }
    const stable = getStable();
    if (!stable || stable.isDestroyed()) return { opened: false };
    const workspace = await developmentWorkspace(project.workspace);
    const server = new URL(project.server),
      origin = server.origin,
      base = server.pathname.replace(/\/$/, "");
    await project.validate();
    stop();
    const processChild = spawn(
      process.execPath,
      [path.join(workspace, "scripts/desktop-development.mjs")],
      {
        cwd: workspace,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          MYCELLIOS_DEVELOPMENT_BASE_PATH: base + "/",
          MYCELLIOS_DEVELOPMENT_PROJECT_NAME: project.project.name,
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child = processChild;
    processChild.stderr?.on("data", (chunk) => record("server: " + String(chunk).slice(0, 2000)));
    processChild.once("exit", (code, signal) => record(`server exit ${code} ${signal}`));
    const port = await new Promise<number>((resolve, reject) => {
      let buffer = "";
      const timeout = setTimeout(() => {
        stop();
        reject(new Error("Development server did not start."));
      }, 90_000);
      processChild.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Could not start development."));
      });
      processChild.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Development server stopped."));
      });
      processChild.stderr?.on("data", () => {
        /* Keep local source diagnostics out of the hosted renderer. */
      });
      processChild.stdout?.on("data", (chunk) => {
        buffer = (buffer + String(chunk)).slice(-8192);
        const match = buffer.match(/MYCELLIOS_DEVELOPMENT_READY (\{[^\r\n]+\})/);
        if (!match) return;
        try {
          const { port } = JSON.parse(match[1]!);
          if (!Number.isInteger(port) || port < 1 || port > 65535) return;
          clearTimeout(timeout);
          resolve(port);
        } catch {
          /* Wait for a complete readiness record. */
        }
      });
    });
    if (stable.isDestroyed()) {
      stop();
      return { opened: false };
    }
    const stableSession = stable.webContents.session;
    record("server ready " + port);
    const devSession = session.fromPartition(
      "mycellios-development-" + createHash("sha256").update(project.key).digest("hex"),
    );
    const uiPreferences: { locale?: string; appearance?: string; spaceId?: string } = {};
    try {
      const values = await stable.webContents.executeJavaScript(
        '({locale:localStorage.getItem("rakazo.uiLocale"),appearance:localStorage.getItem("rakazo.uiAppearance"),spaceId:localStorage.getItem("rakazo:space-id")})',
      );
      if (/^(en|de|ko|tr|hi|pt-BR|zh-CN|es|ru|fr|he|nl|ja)$/.test(values?.locale))
        uiPreferences.locale = values.locale;
      if (["light", "dark", "system"].includes(values?.appearance))
        uiPreferences.appearance = values.appearance;
      if(typeof values?.spaceId==="string" && /^[A-Za-z0-9_-]{1,256}$/.test(values.spaceId))uiPreferences.spaceId=values.spaceId;
    } catch {
      /* Preferences are optional, never a reason to copy account storage. */
    }
    devSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    await devSession.protocol.handle(server.protocol.slice(0, -1), async (request) => {
      const url = new URL(request.url);
      if (url.origin !== origin)
        return devSession.fetch(request, { bypassCustomProtocolHandlers: true });
      await project.validate();
      if (isDevelopmentAsset(request.url, project.server)) {
        if (request.method !== "GET" && request.method !== "HEAD")
          return new Response(null, { status: 405 });
        const accept = request.headers.get("accept");
        const response = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
          ...(accept ? { headers: { accept } } : {}),
          signal: AbortSignal.timeout(30_000),
        });
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        headers.set("cache-control", "no-store");
        headers.set(
          "content-security-policy",
          `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${port}; img-src 'self' https: data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self' https: http://127.0.0.1:*; object-src 'none'; base-uri 'self'`,
        );
        if (request.method !== "HEAD" && headers.get("content-type")?.includes("text/html")) {
          const seed = `<script>(()=>{const p=${JSON.stringify(uiPreferences)};for(const [key,value] of [["rakazo.uiLocale",p.locale],["rakazo.uiAppearance",p.appearance]])if(value&&!localStorage.getItem(key))localStorage.setItem(key,value);if(p.spaceId)localStorage.setItem("rakazo:space-id",p.spaceId);else localStorage.removeItem("rakazo:space-id")})()</script>`;
          return new Response((await response.text()).replace("<head>", "<head>" + seed), {
            status: response.status,
            headers,
          });
        }
        return new Response(request.method === "HEAD" ? null : response.body, {
          status: response.status,
          headers,
        });
      }
      const headers = new Headers(request.headers);
      headers.delete("cookie");
      headers.set("origin", origin);
      // The owning stable session supplies cookies. Vite never receives them.
      return stableSession.fetch(request.url, {
        method: request.method,
        headers,
        ...(request.method === "GET" || request.method === "HEAD"
          ? {}
          : { body: await request.arrayBuffer() }),
        credentials: "include",
        bypassCustomProtocolHandlers: true,
      });
    });
    window = new BrowserWindow({
      ...browserWindowOptions(process.platform),
      title: `${project.project.name} · Desarrollo · Cuenta real`,
      webPreferences: {
        session: devSession,
        preload: path.join(import.meta.dirname, "development-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const openedWindow = window;
    windowProject = project.key;
    openedWindow.webContents.on("console-message", (details, _level, legacyMessage) => {
      const message = details.message ?? legacyMessage;
      if (typeof message === "string" && /vite|failed|error|refused|blocked/i.test(message))
        record("renderer: " + message.slice(0, 1500));
    });
    openedWindow.webContents.on("did-fail-load", (_event, code, description, _url, main) => {
      if (main) record(`load failed ${code} ${description}`);
    });
    openedWindow.webContents.on("did-finish-load", () => record("document loaded"));
    openedWindow.webContents.on("render-process-gone", (_event, details) =>
      record("renderer gone " + details.reason),
    );
    openedWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        event.preventDefault();
        openedWindow.webContents.openDevTools({ mode: "detach" });
      }
    });
    installWindowChrome(openedWindow, process.platform);
    openedWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    openedWindow.webContents.on("will-navigate", (event, url) => {
      const target = new URL(url);
      if (target.origin !== origin || !target.pathname.startsWith(base + "/"))
        event.preventDefault();
    });
    openedWindow.on("page-title-updated", (event) => event.preventDefault());
    const closeDevelopment = () => {
      if (!openedWindow.isDestroyed()) openedWindow.close();
    };
    stable.once("closed", closeDevelopment);
    processChild.once("exit", closeDevelopment);
    openedWindow.once("closed", () => {
      stable.removeListener("closed", closeDevelopment);
      processChild.removeListener("exit", closeDevelopment);
      window = null;
      windowProject = undefined;
      stop();
      devSession.protocol.unhandle(server.protocol.slice(0, -1));
    });
    void openedWindow.loadURL(stable.webContents.getURL()).catch((error) => {
      record("navigation: " + String(error?.code ?? "failed"));
      if (error?.code !== "ERR_ABORTED") closeDevelopment();
    });
    return { opened: true };
  }
  const authorizedDevelopment = (event: IpcMainInvokeEvent) =>
    !!window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === event.sender.mainFrame;
  ipcMain.handle("desktop.development.state", (event) => {
    if (!projects.authorize(event) && !authorizedDevelopment(event))
      throw new Error("Development requires its owning window.");
    return projects.state();
  });
  ipcMain.handle("desktop.development.connect", (event, botId: unknown) => {
    if (!projects.state().active || (!projects.authorize(event) && !authorizedDevelopment(event)))
      throw new Error("Development is not active.");
    return projects.connect(botId);
  });
  ipcMain.handle("desktop.development.open", async (event, botId: unknown) => {
    if (!projects.authorize(event))
      throw new Error("Development requires the stable application window.");
    if (!pending)
      pending = open(botId)
        .catch(() => {
          if (!window) stop();
          return {
            opened: false,
            error:
              "Could not prepare the local development copy. Check the connection and development dependencies.",
          };
        })
        .finally(() => {
          pending = undefined;
        });
    return pending;
  });
  app.on("before-quit", stop);
}
