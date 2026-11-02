import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../../apps/web/src/hosted-login/dashboard-entry.js", import.meta.url), "utf8");
async function page(html: string, check: (dom: JSDOM, request: ReturnType<typeof vi.fn>) => Promise<void>) {
  const dom = new JSDOM(`<div id="panel-navigation"><nav>${html}</nav></div>`, {
    url: "https://www.mycellios.com/dashboard", runScripts: "outside-only",
  });
  const request = vi.fn(async () => new Response(null, { status: 204 }));
  Object.defineProperty(dom.window, "fetch", { value: request });
  vm.runInContext(source, dom.getInternalVMContext());
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  try { await check(dom, request); }
  finally { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); }
}
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const fallback = (dom: JSDOM) => dom.window.document.querySelector("#mycellios-agent-navigation");

it("uses the panel's native Agent link without a second entry", async () => {
  await page('<a href="/agent">Mycellios Agent</a>', async (dom) => {
    await flush(); expect(fallback(dom)).toBeNull();
  });
});
it("adds only one fallback to a legacy panel", async () => {
  await page('<a href="/dashboard">Panel</a>', async (dom) => {
    vm.runInContext(source, dom.getInternalVMContext());
    dom.window.document.body.append(dom.window.document.createElement("span"));
    await flush();
    expect(dom.window.document.querySelectorAll("#mycellios-agent-navigation")).toHaveLength(1);
  });
});
it("removes the fallback when React later mounts the native link", async () => {
  await page("", async (dom) => {
    expect(fallback(dom)).not.toBeNull();
    dom.window.document.querySelector("nav")!.insertAdjacentHTML("afterbegin", '<a href="/agent/">Mycellios Agent</a>');
    await flush(); expect(fallback(dom)).toBeNull();
  });
});
it("restores a single fallback if the native entry disappears", async () => {
  await page('<a href="/agent">Mycellios Agent</a>', async (dom) => {
    dom.window.document.querySelector("a")!.remove();
    await flush(); expect(fallback(dom)).not.toBeNull();
  });
});
it("does not mistake an external link for the Mycellios module", async () => {
  await page('<a href="https://other.example/agent">Other</a>', async (dom) => {
    await flush(); expect(fallback(dom)).not.toBeNull();
  });
});
it("keeps central sign-out synchronized once and ignores other buttons", async () => {
  await page('<button>Other</button><button class="account-signout">Exit</button>', async (dom, request) => {
    vm.runInContext(source, dom.getInternalVMContext());
    dom.window.document.querySelector("button")!.click();
    expect(request).not.toHaveBeenCalled();
    (dom.window.document.querySelector(".account-signout") as HTMLButtonElement).click();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("/agent/api/auth/sign-out", expect.objectContaining({ method: "POST", credentials: "include", keepalive: true }));
  });
});

