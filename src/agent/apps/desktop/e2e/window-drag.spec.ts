import { readFileSync } from "node:fs";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const styles = readFileSync(path.resolve(import.meta.dirname, "../../web/src/styles.css"), "utf8");
const fixture = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Rakazo window drag</title><style>${styles}
    #panel-close { position: fixed; top: 0; right: 0; }
  </style></head>
  <body>
    <main>Desktop fixture ready</main>
    <header class="app-drag" id="conversation-header">
      <span>Chief</span>
      <button class="app-no-drag" id="bot-settings">Bot settings</button>
    </header>
    <output id="result"></output>
    <button id="panel-close">Close panel</button>
    <script>
      document.querySelector('#bot-settings').addEventListener('click', () => {
        document.querySelector('#result').textContent = 'opened';
      });
      document.querySelector('#panel-close').addEventListener('click', () => {
        document.querySelector('#result').textContent = 'closed';
      });
    </script>
  </body>
</html>`;

test("an active Electron window keeps header dragging selection-free and controls clickable", async () => {
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      RAKAZO_WEB_URL: `data:text/html;charset=utf-8,${encodeURIComponent(fixture)}`,
    },
  });

  try {
    const page = await app.firstWindow();
    const active = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.show();
      window?.focus();
      return window?.isFocused();
    });
    expect(active).toBe(true);

    const regions = await page.evaluate(() => {
      const header = document.querySelector("#conversation-header");
      const settings = document.querySelector("#bot-settings");
      if (!(header instanceof HTMLElement) || !(settings instanceof HTMLElement)) {
        throw new Error("missing window chrome fixture");
      }
      const headerStyle = getComputedStyle(header);
      const settingsStyle = getComputedStyle(settings);
      return {
        header: {
          appRegion: headerStyle.getPropertyValue("-webkit-app-region"),
          userSelect: headerStyle.userSelect,
        },
        settings: settingsStyle.getPropertyValue("-webkit-app-region"),
      };
    });

    expect(regions).toEqual({
      header: { appRegion: "drag", userSelect: "none" },
      settings: "no-drag",
    });
    await page.getByRole("button", { name: "Bot settings" }).click();
    await expect(page.locator("#result")).toHaveText("opened");

    if (process.platform === "win32") {
      for (const mode of ["narrow", "maximized", "restored"] as const) {
        await app.evaluate(({ BrowserWindow }, mode) => {
          const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith("data:text/html"));
          if (!win) throw new Error("Missing caption fixture window");
          if (mode === "narrow") win.setSize(460, 580);
          else if (mode === "maximized") win.maximize();
          else win.unmaximize();
        }, mode);
        await expect.poll(async () => {
          const native = await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith("data:text/html"));
            if (!win) throw new Error("Missing caption fixture window");
            return { height: win.getContentBounds().height, maximized: win.isMaximized() };
          });
          return { inset: native.height - await page.evaluate(() => innerHeight), maximized: native.maximized };
        }).toEqual({ inset: 51, maximized: mode === "maximized" });
        await page.getByRole("button", { name: "Close panel" }).click();
        await expect(page.locator("#result")).toHaveText("closed");
        await page.getByRole("button", { name: "Bot settings" }).click();
      }
    }
  } finally {
    await app.close();
  }
});
