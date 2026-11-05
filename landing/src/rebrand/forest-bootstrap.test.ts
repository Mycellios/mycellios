import { readFileSync, statSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("landing/index.html", "utf8");
const script = html.match(/<script id="forest-loader-bootstrap">([\s\S]*?)<\/script>/)![1]!;

class Element extends EventTarget {
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  inert = false;
  removed = false;
  id = "";
  focus = vi.fn();
  sourceParent: Element | null = null;
  constructor(public tagName = "div") { super(); }
  set src(_value: string) { this.sourceParent = this.parentElement; }
  append(...elements: Element[]) { elements.forEach(element => { element.parentElement = this; this.children.push(element); }); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
  contains(element: Element | null): boolean { return element === this || this.children.some(child => child.contains(element)); }
  querySelector() { return this.children[0]; }
  remove() { this.removed = true; }
}

function boot(path = "/?intro=forest", options: { seen?: boolean; reduced?: boolean; storageDenied?: boolean } = {}) {
  const loader = new Element(), root = new Element(), html = new Element(), skip = new Element();
  root.append(skip);
  const document = { documentElement: html, activeElement: null as Element | null,
    getElementById: (id: string) => id === "root" ? root : loader, createElement: (tag: string) => new Element(tag) };
  const sessionStorage = { getItem: () => { if (options.storageDenied) throw new Error("denied"); return options.seen ? "seen" : null; } };
  runInNewContext(script, { document, sessionStorage, URL, Event, location: { href: `https://www.mycellios.com${path}` },
    matchMedia: () => ({ matches: options.reduced ?? false }), setTimeout, clearTimeout });
  const signal = (name: string) => loader.dispatchEvent(new Event(`mycellios:${name}`));
  return { loader, root, html, document, skip, signal };
}

describe("forest bootstrap release safety", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(["/", "/earn", "/pricing", "/compare/grok-bot", "/changelog", "/spore/rewards", "/downloads/desktop", "/dashboard"])("matches the public paper canvas while %s loads", path => {
    expect(boot(path).loader.dataset.theme).toBe("paper");
  });

  it.each(["/network?view=globe", "/dashboard?view=nodes", "/?landing=previous", "/?landing=saved", "/?landing=rooted", "/?landing=assemblage"])("preserves the existing loading theme for %s", path => {
    expect(boot(path).loader.dataset.theme).toBeUndefined();
  });

  it.each(["/dashboard", "/downloads/desktop", "/network", "/?landing=previous", "/?landing=saved", "/?landing=rooted", "/?landing=assemblage", "/?art=fabric", "/#network"])("does not intercept %s", path => {
    const url = new URL(path, "https://www.mycellios.com");
    url.searchParams.set("intro", "forest");
    const page = boot(`${url.pathname}${url.search}${url.hash}`);
    expect(page.loader.dataset.mode).toBeUndefined();
    expect(page.root.inert).toBe(false);
    expect(page.loader.children).toHaveLength(0);
  });

  it("keeps the new homepage direct and the forest opt-in, honoring reduced motion", () => {
    expect(boot("/").loader.children).toHaveLength(0);
    expect(boot("/?intro=forest", { reduced: true }).loader.children).toHaveLength(0);
    expect(boot("/", { seen: true }).loader.children).toHaveLength(0);
    expect(boot("/?intro=forest", { seen: true }).loader.dataset.mode).toBe("forest");
    expect(boot("/?intro=forest", { storageDenied: true }).root.inert).toBe(true);
  });

  it("constructs the responsive picture before assigning src to avoid downloading both orientations", () => {
    const { loader } = boot();
    const picture = loader.children[0]!;
    expect(picture.tagName).toBe("picture");
    expect(picture.children[1]!.sourceParent).toBe(picture);
    for (const orientation of ["", "portrait-"]) {
      const bytes = ["clean", "grown"].reduce((total, frame) => total + statSync(`landing/public/assets/loading/forest-${orientation}${frame}-v1.webp`).size, 0);
      expect(bytes).toBeLessThan(900_000);
    }
  });

  it("never reveals an empty route when the animation module fails or its watchdog expires", () => {
    const page = boot();
    page.signal("forest-disable");
    vi.advanceTimersByTime(10_000);
    expect(page.loader.removed).toBe(false);
    expect(page.root.inert).toBe(true);
    page.signal("route-ready");
    expect(page.loader.removed).toBe(true);
    expect(page.root.inert).toBe(false);
    expect(page.root.attributes["aria-hidden"]).toBeUndefined();
    expect(page.html.dataset.forestLoading).toBeUndefined();
  });

  it("releases a ready page if the module never claims the loader", () => {
    const page = boot();
    page.signal("route-ready");
    vi.advanceTimersByTime(701);
    expect(page.loader.removed).toBe(true);
  });

  it("allows a claimed animation to finish, restores keyboard focus and clears the watchdog", () => {
    const page = boot(), released = vi.fn();
    page.loader.addEventListener("mycellios:loader-released", released);
    page.loader.dataset.claimed = "true";
    page.signal("route-ready");
    vi.advanceTimersByTime(701);
    expect(page.loader.removed).toBe(false);
    page.document.activeElement = page.loader.children[1]!;
    page.signal("forest-finish");
    expect(page.skip.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(page.root.inert).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(released).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
