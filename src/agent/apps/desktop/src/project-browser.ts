import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PreviewBounds, ProjectBrowserState } from "@rakazo/contracts";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { ipcMain, session, WebContentsView } from "electron";

export function projectBrowserUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new Error("Invalid preview URL");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Use an HTTP or HTTPS preview URL without credentials");
  return url.href;
}

export function projectBrowserBounds(value: unknown, width: number, height: number): PreviewBounds {
  if (!value || typeof value !== "object") throw new Error("Invalid preview bounds");
  const bounds = value as PreviewBounds;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite))
    throw new Error("Invalid preview bounds");
  const x = Math.max(0, Math.min(width, Math.round(bounds.x)));
  // Keep all page content below the application's native window controls.
  const y = Math.max(51, Math.min(height, Math.round(bounds.y)));
  return {
    x,
    y,
    width: Math.max(0, Math.min(width - x, Math.round(bounds.width))),
    height: Math.max(0, Math.min(height - y, Math.round(bounds.height))),
  };
}

type Entry = {
  id: string;
  view: WebContentsView;
  owner: BrowserWindow;
  scope: string;
  generation: string;
  selecting: boolean;
  error?: string;
};

/** No application cookies, preload bridge, OS tools or remote-debugging port reach a page. */
export function installProjectBrowser(options: {
  getWindow(): BrowserWindow | null;
  authorize(event: IpcMainInvokeEvent): boolean;
  scope(): Promise<string>;
}) {
  let active: Entry | undefined;
  const entries = new Map<string, Entry>();
  const partitions = new Map<string, string>();
  const watched = new WeakSet<BrowserWindow>();
  const emit = (entry: Entry, extra: Partial<ProjectBrowserState> = {}) => {
    const wc = entry.view.webContents;
    if (entry.owner.isDestroyed() || wc.isDestroyed()) return;
    entry.owner.webContents.send("desktop.preview.changed", {
      id: entry.id,
      url: wc.getURL(),
      title: wc.getTitle().slice(0, 200),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      selecting: entry.selecting,
      ...(entry.error ? { error: entry.error } : {}),
      ...extra,
    } satisfies ProjectBrowserState);
  };
  const inspect = (entry: Entry) => {
    if (!entry.view.webContents.isDestroyed())
      entry.view.webContents.send("desktop.preview.inspect", {
        token: entry.generation,
        enabled: entry.selecting,
      });
  };
  const invalidate = (entry: Entry, selecting = false) => {
    entry.generation = randomUUID();
    entry.selecting = selecting;
    if (entry.view.webContents.getURL()) inspect(entry);
  };
  const close = (entry: Entry) => {
    entries.delete(entry.id);
    if (active === entry) active = undefined;
    if (!entry.owner.isDestroyed()) entry.owner.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  };
  const reset = () => {
    for (const entry of [...entries.values()]) {
      entry.error = "The application changed. Reload the preview.";
      emit(entry);
      close(entry);
    }
    partitions.clear();
  };
  async function owner(event: IpcMainInvokeEvent) {
    const win = options.getWindow();
    if (!win || win.isDestroyed() || !options.authorize(event))
      throw new Error("Preview requires the owning application window");
    const scope = await options.scope();
    if (options.getWindow() !== win || !options.authorize(event))
      throw new Error("The application changed");
    for (const entry of [...entries.values()])
      if (entry.owner !== win || entry.scope !== scope) close(entry);
    return { win, scope };
  }
  const idOf = (value: unknown) => {
    if (typeof value !== "string" || !value || value.length > 8192)
      throw new Error("Invalid preview tab");
    return value;
  };
  function layout(entry: Entry, bounds: PreviewBounds | null) {
    if (bounds === null) {
      if (entry.selecting) {
        invalidate(entry);
        emit(entry);
      }
      entry.view.setVisible(false);
      return;
    }
    const [width = 0, height = 0] = entry.owner.getContentSize();
    const zoom = entry.owner.webContents.getZoomFactor();
    const scaled = Object.fromEntries(
      Object.entries(bounds).map(([key, value]) => [key, value * zoom]),
    );
    const rect = projectBrowserBounds(scaled, width, height);
    const before = entry.view.getBounds();
    if (entry.selecting && (before.width !== rect.width || before.height !== rect.height))
      invalidate(entry, true);
    entry.view.setBounds(rect);
    entry.view.setVisible(rect.width > 0 && rect.height > 0);
  }
  function create(id: string, win: BrowserWindow, scope: string) {
    if (!watched.has(win)) {
      watched.add(win);
      win.once("closed", reset);
      win.webContents.on("did-start-navigation", (_event, _url, inPlace, main) => {
        if (main && !inPlace) reset();
      });
      win.webContents.on("did-navigate-in-page", async () => {
        try {
          if (active && active.scope !== (await options.scope())) reset();
        } catch {
          reset();
        }
      });
    }
    while (entries.size >= 4) close(entries.values().next().value!);
    let partition = partitions.get(scope);
    if (!partition) {
      partitions.clear();
      partition = `project-preview-${randomUUID()}`;
      partitions.set(scope, partition);
    }
    const isolated = session.fromPartition(partition);
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.on("will-download", (event) => event.preventDefault());
    const view = new WebContentsView({
      webPreferences: {
        session: isolated,
        preload: path.join(import.meta.dirname, "project-browser-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    const entry: Entry = {
      id,
      owner: win,
      scope,
      view,
      generation: randomUUID(),
      selecting: false,
    };
    entries.set(id, entry);
    view.setVisible(false);
    win.contentView.addChildView(view);
    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-attach-webview", (event) => event.preventDefault());
    const navigate = (event: { preventDefault(): void }, url: string) => {
      try {
        projectBrowserUrl(url);
      } catch {
        event.preventDefault();
      }
    };
    wc.on("will-navigate", navigate);
    wc.on("will-redirect", navigate);
    wc.on("did-start-navigation", (_event, _url, inPlace, main) => {
      if (!main) return;
      if (!inPlace) {
        invalidate(entry);
        entry.error = undefined;
      }
      emit(entry);
    });
    wc.on("did-navigate-in-page", () => {
      invalidate(entry);
      emit(entry);
    });
    wc.on("did-finish-load", () => {
      inspect(entry);
      emit(entry);
    });
    wc.on("did-stop-loading", () => emit(entry));
    wc.on("page-title-updated", () => emit(entry));
    wc.on("did-fail-load", (_event, code, _description, _url, main) => {
      if (main && code !== -3) {
        entry.error = "Could not load this page. Check its URL and server.";
        emit(entry);
      }
    });
    wc.on("render-process-gone", () => {
      entry.error = "This page stopped. Reload to retry.";
      emit(entry);
    });
    wc.on("preload-error", () => {
      entry.error = "Could not prepare element selection. Reload to retry.";
      emit(entry);
    });
    wc.on("ipc-message", async (event, channel, data: unknown) => {
      if (channel === "desktop.preview.ready" && event.senderFrame === wc.mainFrame) {
        inspect(entry);
        return;
      }
      if (
        channel === "desktop.preview.cancel" &&
        active === entry &&
        entry.selecting &&
        event.senderFrame === wc.mainFrame &&
        data &&
        typeof data === "object" &&
        (data as { token?: unknown }).token === entry.generation
      ) {
        invalidate(entry);
        emit(entry);
        return;
      }
      if (
        channel !== "desktop.preview.selection" ||
        active !== entry ||
        !entry.selecting ||
        event.senderFrame !== wc.mainFrame ||
        !data ||
        typeof data !== "object"
      )
        return;
      const selection = data as {
        token?: unknown;
        selector?: unknown;
        text?: unknown;
        rect?: unknown;
      };
      if (
        selection.token !== entry.generation ||
        typeof selection.selector !== "string" ||
        !selection.selector ||
        selection.selector.length > 1000 ||
        typeof selection.text !== "string" ||
        selection.text.length > 2000
      )
        return;
      const generation = entry.generation;
      try {
        if ((await options.scope()) !== entry.scope || options.getWindow() !== win) return;
        const bounds = view.getBounds();
        const raw = selection.rect as PreviewBounds | undefined;
        if (!raw || ![raw.x, raw.y, raw.width, raw.height].every(Number.isFinite)) return;
        const pageZoom = wc.getZoomFactor();
        const x = Math.max(0, Math.min(bounds.width - 1, Math.floor(raw.x * pageZoom)));
        const y = Math.max(0, Math.min(bounds.height - 1, Math.floor(raw.y * pageZoom)));
        const rect = {
          x,
          y,
          width: Math.max(1, Math.min(bounds.width - x, Math.ceil(raw.width * pageZoom))),
          height: Math.max(1, Math.min(bounds.height - y, Math.ceil(raw.height * pageZoom))),
        };
        const capture = await wc.capturePage(rect);
        const currentScope = await options.scope();
        if (
          active !== entry ||
          entry.generation !== generation ||
          entries.get(id) !== entry ||
          !entry.selecting ||
          currentScope !== scope
        )
          return;
        const png = capture.toPNG();
        entry.selecting = false;
        inspect(entry);
        emit(entry, {
          selection: {
            selector: selection.selector,
            text: selection.text,
            ...(png.length > 0 && png.length <= 3 * 1024 * 1024
              ? { screenshot: `data:image/png;base64,${png.toString("base64")}` }
              : {}),
          },
        });
      } catch {
        /* Navigation or closing invalidates an in-flight capture. */
      }
    });
    return entry;
  }
  ipcMain.handle(
    "desktop.preview.show",
    async (event, request: { id: unknown; url: unknown; bounds: PreviewBounds }) => {
      const { win, scope } = await owner(event);
      const id = idOf(request?.id),
        url = projectBrowserUrl(request?.url);
      // Validate before allocating browser processes.
      const [width = 0, height = 0] = win.getContentSize();
      projectBrowserBounds(request?.bounds, width, height);
      const entry = entries.get(id) ?? create(id, win, scope);
      if (active && active !== entry) layout(active, null);
      active = entry;
      layout(entry, request.bounds);
      if (entry.view.webContents.getURL() !== url) {
        invalidate(entry);
        entry.error = undefined;
        void entry.view.webContents.loadURL(url).catch(() => {
          if (entries.get(id) === entry) {
            entry.error = "Could not load this page. Check its URL and server.";
            emit(entry);
          }
        });
      }
      emit(entry);
    },
  );
  ipcMain.handle(
    "desktop.preview.layout",
    async (event, request: { id: unknown; bounds: PreviewBounds | null }) => {
      await owner(event);
      const entry = entries.get(idOf(request?.id));
      if (entry && active === entry) layout(entry, request.bounds);
    },
  );
  ipcMain.handle(
    "desktop.preview.command",
    async (event, request: { id: unknown; action: unknown; enabled?: unknown }) => {
      await owner(event);
      const entry = entries.get(idOf(request?.id));
      if (!entry || active !== entry) throw new Error("Open the preview first");
      const wc = entry.view.webContents;
      if (request.action === "select") {
        invalidate(entry, request.enabled === true);
      } else if (request.action === "reload") {
        invalidate(entry);
        entry.error = undefined;
        wc.reload();
      } else if (request.action === "back" && wc.navigationHistory.canGoBack()) {
        invalidate(entry);
        wc.navigationHistory.goBack();
      } else if (request.action === "forward" && wc.navigationHistory.canGoForward()) {
        invalidate(entry);
        wc.navigationHistory.goForward();
      } else throw new Error("Preview action unavailable");
      emit(entry);
    },
  );
  ipcMain.handle("desktop.preview.close", async (event, value: unknown) => {
    await owner(event);
    const entry = entries.get(idOf(value));
    if (entry) close(entry);
  });
  return { dispose: reset };
}
