// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => vi.fn());
vi.mock("../lib/desktop", () => ({ desktopBridge: bridge }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
vi.mock("@rakazo/ui-web", () => ({ buttonVariants: () => "" }));
import { DesktopDownloadLink } from "./DesktopDownloadLink";
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); bridge.mockReturnValue(undefined); });
async function rendered(check: (host: HTMLDivElement) => void, mini = false) {
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<DesktopDownloadLink mini={mini}/>));check(host);}finally{await act(async()=>root.unmount());host.remove();}
}
it("offers the Desktop download in a browser or installed PWA without replacing the chat", async()=>{
 await rendered(host=>{const link=host.querySelector("a")!;expect(link.href).toBe("https://www.mycellios.com/downloads/desktop");expect(link.target).toBe("_blank");expect(link.rel).toContain("noopener");expect(link.textContent).toContain("Get Mycellios Desktop");});
});
it("keeps the collapsed sidebar download accessible",async()=>{
 await rendered(host=>{const link=host.querySelector("a")!;expect(link.getAttribute("aria-label")).toBe("Get Mycellios Desktop");expect(link.title).toBe("Get Mycellios Desktop");},true);
});
it("hides the download in the native Desktop app",async()=>{
 bridge.mockReturnValue({platform:"win32"});await rendered(host=>expect(host.querySelector("a")).toBeNull());
});
