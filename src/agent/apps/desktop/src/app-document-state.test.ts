// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_DOCUMENT_STATE_SCRIPT, AppDocumentReadyTimeout, loadWithCloudRendererRecovery } from "./app-document-state.js";

function stateOf(html: string) {
  document.body.innerHTML = html;
  // Run the script the way the main process injects it into the renderer.
  return new Function(`return ${APP_DOCUMENT_STATE_SCRIPT};`)() as unknown;
}

describe("app document state", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("waits while the session is pending", () => {
    expect(
      stateOf(
        '<div id="root"><div data-rakazo-app-state="session-pending">Opening your Space…</div></div>',
      ),
    ).toBe("pending");
  });

  it("is ready once the session and a usable surface are mounted", () => {
    expect(
      stateOf(
        '<div id="root"><div data-rakazo-app-state="ready"><div data-testid="shell-root" data-ready="true"></div></div></div>',
      ),
    ).toBe("ready");
  });

  it("reports the web app's error screen so launch keeps its Refresh", () => {
    expect(
      stateOf(
        '<div id="root"><div data-rakazo-app-state="failed"><p>Something went wrong. Try again.</p><button>Refresh</button></div></div>',
      ),
    ).toBe("failed");
  });
});

describe("bundled cloud renderer recovery", () => {
  const pending = new AppDocumentReadyTimeout("The server page did not become ready.");

  it("retries with the original HTTPS protocol after a mount timeout", async () => {
    const steps: string[] = [];
    const load = vi.fn(async () => {
      steps.push("load");
      if (steps.length === 1) throw pending;
      return "ready" as const;
    });
    await expect(loadWithCloudRendererRecovery(load, () => { steps.push("restore"); })).resolves.toBe("ready");
    expect(steps).toEqual(["load", "restore", "load"]);
  });

  it("leaves successful loads and ordinary HTTP errors alone", async () => {
    const restore = vi.fn();
    const httpError = new Error("The server answered with HTTP 502.");
    const load = vi.fn().mockResolvedValueOnce("ready").mockResolvedValueOnce("failed").mockRejectedValueOnce(httpError);
    await expect(loadWithCloudRendererRecovery(load, restore)).resolves.toBe("ready");
    await expect(loadWithCloudRendererRecovery(load, restore)).resolves.toBe("failed");
    await expect(loadWithCloudRendererRecovery(load, restore)).rejects.toBe(httpError);
    expect(restore).not.toHaveBeenCalled();
  });

  it("attempts recovery only once and only when a cloud fallback is available", async () => {
    const load = vi.fn().mockRejectedValue(pending);
    await expect(loadWithCloudRendererRecovery(load)).rejects.toBe(pending);
    expect(load).toHaveBeenCalledOnce();
    load.mockClear();
    const restore = vi.fn();
    await expect(loadWithCloudRendererRecovery(load, restore)).rejects.toBe(pending);
    expect(restore).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
