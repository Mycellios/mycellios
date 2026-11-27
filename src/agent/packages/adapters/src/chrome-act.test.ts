// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
// @ts-expect-error The extension is plain JavaScript without declarations.
import { snapshotPage } from "../../../apps/browser-extension/page-agent.js";
// @ts-expect-error The extension is plain JavaScript without declarations.
import * as sensitive from "../../../apps/browser-extension/sensitive.js";
// @ts-expect-error The extension is plain JavaScript without declarations.
import * as bridge from "../../../apps/browser-extension/tabs-bridge.js";

type Ui = {
  ask: (q: unknown) => Promise<string>;
  confirm: (q: { kind: string; site: string; label: string }) => Promise<string>;
  actAllowed: () => Promise<boolean>;
};
type Confirm = Ui["confirm"];
type Result = {
  error?: string;
  acted?: {
    steps: { ok: boolean; note?: string }[];
    page?: { text: string };
    downloads?: string[];
  };
  navigated?: { tab: string; url: string };
};
const { actTab, navigateTab, releaseWorking } = bridge as {
  actTab(request: unknown, ui: Ui): Promise<Result>;
  navigateTab(request: unknown, ui: Ui): Promise<Result>;
  releaseWorking(): Promise<void>;
};

const mico = { name: "Ada", color: "green" };
const here = () => location.href;

describe("consent classes", () => {
  it("asks for password, one-time code and verification fields, whatever their type", () => {
    for (const field of [
      { type: "password" },
      { type: "text", autocomplete: "one-time-code" },
      { type: "text", autocomplete: "new-password" },
      { type: "text", name: "otp" },
      { type: "text", id: "pwd" },
      { type: "text", label: "Verification code" },
    ])
      expect(sensitive.fieldConsentClass(field)).toBe("password");
    for (const field of [
      { type: "text", name: "email" },
      { type: "text", label: "Passenger name" },
      { type: "search", name: "q" },
    ])
      expect(sensitive.fieldConsentClass(field)).toBeNull();
  });

  it("asks for card number, expiry, security code and IBAN, before treating the field as a password", () => {
    for (const field of [
      { type: "text", autocomplete: "cc-number" },
      { type: "text", autocomplete: "cc-csc" },
      { type: "text", name: "cardnumber" },
      { type: "text", name: "cvv" },
      { type: "text", label: "IBAN" },
      { type: "text", label: "Número de tarjeta" },
      { type: "password", autocomplete: "cc-csc" },
    ])
      expect(sensitive.fieldConsentClass(field)).toBe("payment");
  });

  it("asks before a click that signs in, pays, or goes to an identity provider", () => {
    expect(sensitive.clickConsentClass({ submitsForm: true, formHasPassword: true })).toBe(
      "sign_in",
    );
    expect(
      sensitive.clickConsentClass({
        submitsForm: true,
        formHasPayment: true,
        formHasPassword: true,
      }),
    ).toBe("payment");
    expect(
      sensitive.clickConsentClass({
        href: "https://accounts.google.com/o/oauth2/v2/auth?client_id=1&response_type=code",
      }),
    ).toBe("sign_in");
    expect(
      sensitive.clickConsentClass({
        href: "https://app.example/connect?client_id=9&redirect_uri=https%3A%2F%2Fapp.example%2Fcb",
      }),
    ).toBe("sign_in");
    expect(sensitive.clickConsentClass({ pageHasPaymentFrame: true, text: "Pay now" })).toBe(
      "payment",
    );
    expect(sensitive.clickConsentClass({ pageHasPaymentFrame: false, text: "Pay now" })).toBeNull();
    expect(sensitive.clickConsentClass({ submitsForm: true, href: "" })).toBeNull();
    expect(sensitive.clickConsentClass({ href: "https://shop.example/cart" })).toBeNull();
  });

  it("treats Enter inside a form like its submit button, and other keys as harmless", () => {
    const login = { target: { inForm: true, formHasPassword: true } };
    expect(sensitive.actionConsentClass({ kind: "key", key: "Enter" }, login)).toBe("sign_in");
    expect(sensitive.actionConsentClass({ kind: "key", key: "Tab" }, login)).toBeNull();
    expect(sensitive.actionConsentClass({ kind: "scroll", direction: "down" }, login)).toBeNull();
    expect(
      sensitive.actionConsentClass({ kind: "select", ref: "e1", text: "x" }, login),
    ).toBeNull();
  });

  it("recognises identity-provider and payment-provider addresses", () => {
    expect(
      sensitive.isSignInAddress("https://login.microsoftonline.com/common/oauth2/authorize"),
    ).toBe(true);
    expect(sensitive.isSignInAddress("https://shop.example/login")).toBe(false);
    expect(sensitive.isPaymentHost("https://js.stripe.com/v3/")).toBe(true);
    expect(sensitive.isPaymentHost("https://shop.example/pay")).toBe(false);
  });
});

describe("acting in a tab", () => {
  let confirm: Mock<Confirm>;
  let ui: Ui;
  let downloadListeners: ((item: { id: number; url: string; filename: string }) => void)[];
  let chromeStub: ReturnType<typeof makeChrome>;

  function makeChrome(tabUrl: string) {
    const tabs = new Map<
      number,
      {
        id: number;
        windowId: number;
        url: string;
        title: string;
        status: string;
        incognito: boolean;
      }
    >();
    tabs.set(5, {
      id: 5,
      windowId: 1,
      url: tabUrl,
      title: "Shop",
      status: "complete",
      incognito: false,
    });
    let nextTab = 6;
    return {
      tabs,
      api: {
        tabs: {
          get: vi.fn(async (id: number) => {
            const tab = tabs.get(id);
            if (!tab) throw new Error("no tab");
            return tab;
          }),
          create: vi.fn(async ({ url, windowId }: { url: string; windowId?: number }) => {
            const tab = {
              id: nextTab++,
              windowId: windowId ?? 1,
              url,
              title: "New",
              status: "complete",
              incognito: false,
            };
            tabs.set(tab.id, tab);
            return tab;
          }),
          update: vi.fn(async (id: number, change: { url?: string }) => {
            const tab = tabs.get(id)!;
            if (change.url) tab.url = change.url;
            return tab;
          }),
          remove: vi.fn(async (id: number) => {
            tabs.delete(id);
          }),
          group: vi.fn(async () => 77),
          ungroup: vi.fn(async () => {}),
        },
        tabGroups: { update: vi.fn(async () => ({})) },
        windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
        permissions: { contains: vi.fn(async () => true), remove: vi.fn(async () => true) },
        scripting: {
          executeScript: vi.fn(
            async ({
              func,
              args = [],
            }: {
              func: (...a: unknown[]) => unknown;
              args?: unknown[];
            }) => [{ result: await func(...args) }],
          ),
        },
        downloads: {
          onCreated: {
            addListener: (
              listener: (item: { id: number; url: string; filename: string }) => void,
            ) => downloadListeners.push(listener),
            removeListener: (
              listener: (item: { id: number; url: string; filename: string }) => void,
            ) => {
              downloadListeners = downloadListeners.filter((item) => item !== listener);
            },
          },
          pause: vi.fn(async () => {}),
          resume: vi.fn(async () => {}),
          cancel: vi.fn(async () => {}),
          erase: vi.fn(async () => []),
        },
      },
    };
  }

  beforeEach(() => {
    downloadListeners = [];
    confirm = vi.fn<Confirm>(async () => "allow");
    ui = { ask: vi.fn(async () => "always"), confirm, actAllowed: async () => true };
    chromeStub = makeChrome(here());
    vi.stubGlobal("chrome", chromeStub.api);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 10,
      height: 10,
      left: 0,
      top: 0,
    } as DOMRect);
    (globalThis as { __mycelliosPersonAt?: number }).__mycelliosPersonAt = undefined;
  });
  afterEach(async () => {
    await releaseWorking();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  /** Takes a snapshot first, as a Mico does, so refs exist; returns the ref of each element in order. */
  const page = (html: string) => {
    document.body.innerHTML = html;
    const snap = snapshotPage(48_000) as { text: string };
    return Array.from(snap.text.matchAll(/\[(e\d+)\]/g), (match) => match[1]!);
  };

  it("fills an ordinary field without asking, and puts the Mico's name on the page and its tab in a group", async () => {
    const [name] = page('<label for="n">Name</label><input id="n">');
    const result = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "fill", ref: name, text: "Ada" }], mico },
      ui,
    );
    expect(result.acted?.steps).toEqual([{ ok: true }]);
    expect((document.getElementById("n") as HTMLInputElement).value).toBe("Ada");
    expect(confirm).not.toHaveBeenCalled();
    expect(chromeStub.api.tabs.group).toHaveBeenCalled();
    expect(chromeStub.api.tabGroups.update).toHaveBeenCalledWith(77, {
      title: "Ada",
      color: "green",
    });
    expect(result.acted?.page?.text).toContain("Interactive elements");
  });

  it("asks before typing into a password field, and does not type when the person declines", async () => {
    const [pw] = page('<input type="password" id="pw">');
    confirm.mockResolvedValueOnce("deny");
    const declined = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "fill", ref: pw, text: "hunter2" }], mico },
      ui,
    );
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "password" }));
    expect(declined.acted?.steps).toEqual([
      { ok: false, note: "declined by the person: password field" },
    ]);
    expect((document.getElementById("pw") as HTMLInputElement).value).toBe("");
    // No answer is a refusal too.
    confirm.mockResolvedValueOnce("timeout");
    const silent = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "fill", ref: pw, text: "hunter2" }], mico },
      ui,
    );
    expect(silent.acted?.steps[0]).toEqual({ ok: false, note: "no answer from the person" });
    expect((document.getElementById("pw") as HTMLInputElement).value).toBe("");
    const allowed = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "fill", ref: pw, text: "hunter2" }], mico },
      ui,
    );
    expect(allowed.acted?.steps).toEqual([{ ok: true }]);
    expect((document.getElementById("pw") as HTMLInputElement).value).toBe("hunter2");
    // The snapshot afterwards never shows the secret.
    expect(allowed.acted?.page?.text).not.toContain("hunter2");
  });

  it("asks before card details and before submitting a sign-in, stopping the rest of the steps", async () => {
    const refs = page(
      `<form id="f"><input name="email" id="email"><input autocomplete="cc-number" id="cc"><button id="go">Place order</button></form>`,
    );
    document.getElementById("f")!.addEventListener("submit", (event) => event.preventDefault());
    confirm.mockResolvedValueOnce("deny");
    const card = await actTab(
      {
        op: "act",
        tab: "t5",
        actions: [
          { kind: "fill", ref: refs[0], text: "a@b.c" },
          { kind: "fill", ref: refs[1], text: "4111111111111111" },
          { kind: "click", ref: refs[2] },
        ],
        mico,
      },
      ui,
    );
    expect(card.acted?.steps).toEqual([
      { ok: true },
      { ok: false, note: "declined by the person: payment details" },
      { ok: false, note: "skipped" },
    ]);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "payment" }));
    expect((document.getElementById("cc") as HTMLInputElement).value).toBe("");
    // Clicking submit on a form with card fields is asked about as payment, not just as a click.
    confirm.mockClear();
    confirm.mockResolvedValueOnce("deny");
    const submit = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "click", ref: refs[2] }], mico },
      ui,
    );
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "payment" }));
    expect(submit.acted?.steps[0]?.ok).toBe(false);
  });

  it("asks before Enter submits a login form", async () => {
    const [user, pw] = page(
      '<form id="f"><input id="u" name="user"><input id="p" type="password"></form>',
    );
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.getElementById("f")!.addEventListener("submit", submitted);
    confirm.mockResolvedValueOnce("deny");
    const denied = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "key", ref: user, key: "Enter" }], mico },
      ui,
    );
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "sign_in" }));
    expect(denied.acted?.steps[0]).toEqual({ ok: false, note: "declined by the person: sign-in" });
    expect(submitted).not.toHaveBeenCalled();
    expect(pw).toBeDefined();
  });

  it("reports a click that changes nothing as not confirmed, never as done", async () => {
    const [button] = page("<button>Nothing</button>");
    const result = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "click", ref: button }], mico },
      ui,
    );
    expect(result.acted?.steps).toEqual([
      { ok: false, note: "not confirmed: nothing visibly changed" },
    ]);
    const [more] = page('<button id="b">More</button>');
    document.getElementById("b")!.addEventListener("click", () => {
      document.body.append(document.createElement("p"));
    });
    const done = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "click", ref: more }], mico },
      ui,
    );
    expect(done.acted?.steps).toEqual([{ ok: true }]);
  });

  it("selects an option by text and refuses refs from an older page", async () => {
    const [list] = page(
      '<select id="s"><option value="a">Small</option><option value="b">Large</option></select>',
    );
    const picked = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "select", ref: list, text: "large" }], mico },
      ui,
    );
    expect(picked.acted?.steps).toEqual([{ ok: true }]);
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("b");
    const missing = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "select", ref: list, text: "huge" }], mico },
      ui,
    );
    expect(missing.acted?.steps).toEqual([{ ok: false, note: "no such option" }]);
    document.body.innerHTML = "<p>new page</p>";
    const stale = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "select", ref: list, text: "small" }], mico },
      ui,
    );
    expect(stale.acted?.steps).toEqual([{ ok: false, note: "stale ref: take a new snapshot" }]);
  });

  it("yields to the person: it does nothing when they just used the tab, and stops if they start mid-run", async () => {
    const [field] = page('<input id="n">');
    const input = () => document.getElementById("n") as HTMLInputElement;
    const person = globalThis as { __mycelliosPersonAt?: number };
    // The guard starts when the Mico first prepares the tab.
    await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "scroll", direction: "down" }], mico },
      ui,
    );
    // An event the page itself dispatches is not the person (isTrusted is false).
    window.dispatchEvent(new Event("keydown", { bubbles: true }));
    expect(person.__mycelliosPersonAt).toBeUndefined();
    const first = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "fill", ref: field, text: "Ada" }], mico },
      ui,
    );
    expect(first.acted?.steps).toEqual([{ ok: true }]);
    // The person's own input (the guard stamps trusted events) makes the Mico wait.
    person.__mycelliosPersonAt = Date.now();
    const result = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "fill", ref: field, text: "Bob" }], mico },
      ui,
    );
    expect(result).toEqual({ error: "person_active" });
    expect(input().value).toBe("Ada");
    // After a few quiet seconds it may continue.
    person.__mycelliosPersonAt = Date.now() - 4_000;
    const later = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "fill", ref: field, text: "Bob" }], mico },
      ui,
    );
    expect(later.acted?.steps).toEqual([{ ok: true }]);
    expect(input().value).toBe("Bob");
  });

  it("never acts on Mycellios, the Web Store or a password manager, and asks nothing", async () => {
    for (const url of [
      "https://www.mycellios.com/agent/app",
      "https://chromewebstore.google.com/",
      "https://vault.bitwarden.com/",
      "chrome://settings",
    ]) {
      chromeStub.tabs.get(5)!.url = url;
      const result = await actTab(
        { op: "act", tab: "t5", actions: [{ kind: "scroll", direction: "down" }], mico },
        ui,
      );
      expect(result.error).toMatch(/refused_site|not_web_page/);
    }
    expect(chromeStub.api.scripting.executeScript).not.toHaveBeenCalled();
    expect(ui.ask).not.toHaveBeenCalled();
  });

  it("asks about a new site first, and removes a one-time grant afterwards", async () => {
    page("<p>hi</p>");
    chromeStub.api.permissions.contains.mockResolvedValue(false);
    (ui.ask as ReturnType<typeof vi.fn>).mockResolvedValueOnce("deny");
    expect(
      await actTab(
        { op: "act", tab: "t5", actions: [{ kind: "scroll", direction: "down" }], mico },
        ui,
      ),
    ).toEqual({ error: "declined" });
    expect(chromeStub.api.scripting.executeScript).not.toHaveBeenCalled();
    (ui.ask as ReturnType<typeof vi.fn>).mockResolvedValueOnce("once");
    const done = await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "scroll", direction: "down" }], mico },
      ui,
    );
    expect(done.acted).toBeDefined();
    expect(chromeStub.api.permissions.remove).toHaveBeenCalledWith({
      origins: [`${new URL(here()).origin}/*`],
    });
  });

  it("holds a download that starts during an action until the person keeps or cancels it", async () => {
    const run = async (answer: string) => {
      const [button] = page('<button id="b">Download report</button>');
      document.getElementById("b")!.addEventListener("click", () => {
        for (const listener of downloadListeners)
          listener({ id: 41, url: "https://shop.example/files/report.pdf", filename: "" });
        document.body.append(document.createElement("p"));
      });
      confirm.mockResolvedValueOnce(answer);
      return actTab({ op: "act", tab: "t5", actions: [{ kind: "click", ref: button }], mico }, ui);
    };
    const cancelled = await run("deny");
    expect(chromeStub.api.downloads.pause).toHaveBeenCalledWith(41);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "download", label: "report.pdf" }),
    );
    expect(chromeStub.api.downloads.cancel).toHaveBeenCalledWith(41);
    expect(chromeStub.api.downloads.erase).toHaveBeenCalledWith({ id: 41 });
    expect(cancelled.acted?.downloads).toEqual(["cancelled"]);
    chromeStub.api.downloads.resume.mockClear();
    const kept = await run("allow");
    expect(chromeStub.api.downloads.resume).toHaveBeenCalledWith(41);
    expect(kept.acted?.downloads).toEqual(["kept"]);
    // Outside an action nobody listens, so the person's own downloads are untouched.
    expect(downloadListeners).toHaveLength(0);
  });

  it("on release, the overlay goes and only the person's own tabs leave the group", async () => {
    page("<p>x</p>");
    await actTab(
      { op: "act", tab: "t5", actions: [{ kind: "scroll", direction: "down" }], mico },
      ui,
    );
    expect(document.documentElement.lastElementChild?.tagName).toBe("DIV");
    const opened = await navigateTab(
      { op: "navigate", url: "https://shop.example/", newTab: true, mico },
      ui,
    );
    expect(opened.navigated?.tab).toBe("t6");
    await releaseWorking();
    expect(chromeStub.api.tabs.ungroup).toHaveBeenCalledWith(5);
    expect(chromeStub.api.tabs.ungroup).not.toHaveBeenCalledWith(6);
  });
});

describe("opening pages in the person's Chrome", () => {
  let confirm: Mock<Confirm>;
  let ui: Ui;
  let tabs: Map<
    number,
    { id: number; windowId: number; url: string; title: string; status: string; incognito: boolean }
  >;
  let api: Record<string, unknown> & { tabs: Record<string, ReturnType<typeof vi.fn>> };

  beforeEach(() => {
    confirm = vi.fn<Confirm>(async () => "allow");
    ui = { ask: vi.fn(async () => "always"), confirm, actAllowed: async () => true };
    tabs = new Map([
      [
        5,
        {
          id: 5,
          windowId: 1,
          url: "https://mine.example/",
          title: "Mine",
          status: "complete",
          incognito: false,
        },
      ],
    ]);
    let next = 6;
    api = {
      tabs: {
        get: vi.fn(async (id: number) => {
          const tab = tabs.get(id);
          if (!tab) throw new Error("gone");
          return tab;
        }),
        create: vi.fn(async ({ url, windowId }: { url: string; windowId?: number }) => {
          const tab = {
            id: next++,
            windowId: windowId ?? 1,
            url,
            title: "Opened",
            status: "complete",
            incognito: false,
          };
          tabs.set(tab.id, tab);
          return tab;
        }),
        update: vi.fn(async (id: number, change: { url?: string }) => {
          const tab = tabs.get(id)!;
          if (change.url) tab.url = change.url;
          return tab;
        }),
        remove: vi.fn(async (id: number) => {
          tabs.delete(id);
        }),
        group: vi.fn(async () => 9),
        ungroup: vi.fn(async () => {}),
      },
      tabGroups: { update: vi.fn(async () => ({})) },
      windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
      scripting: { executeScript: vi.fn(async () => []) },
    } as never;
    vi.stubGlobal("chrome", api);
  });
  afterEach(async () => {
    await releaseWorking();
    vi.unstubAllGlobals();
  });

  it("opens a new tab in the Mico's group, in the background, and reports where it ended", async () => {
    const result = await navigateTab(
      { op: "navigate", url: "https://shop.example/cart?x=1", newTab: true, mico },
      ui,
    );
    expect(api.tabs.create).toHaveBeenCalledWith({
      url: "https://shop.example/cart?x=1",
      active: false,
      windowId: 1,
    });
    expect(result.navigated).toMatchObject({ tab: "t6", url: "https://shop.example/cart" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("never navigates one of the person's own tabs away, only tabs the Mico already works in", async () => {
    expect(
      await navigateTab({ op: "navigate", url: "https://shop.example/", tab: "t5", mico }, ui),
    ).toEqual({ error: "tab_not_working" });
    expect(api.tabs.update).not.toHaveBeenCalled();
    const opened = await navigateTab(
      { op: "navigate", url: "https://shop.example/", newTab: true, mico },
      ui,
    );
    const moved = await navigateTab(
      { op: "navigate", url: "https://shop.example/checkout", tab: opened.navigated!.tab, mico },
      ui,
    );
    expect(moved.navigated?.url).toBe("https://shop.example/checkout");
  });

  it("refuses Mycellios, password managers and non-web addresses without opening anything", async () => {
    for (const url of [
      "https://www.mycellios.com/agent/app",
      "https://vault.bitwarden.com/",
      "javascript:alert(1)",
      "chrome://settings",
      "https://u:p@shop.example/",
    ])
      expect((await navigateTab({ op: "navigate", url, newTab: true, mico }, ui)).error).toMatch(
        /refused_site|not_web_page/,
      );
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it("asks before opening a sign-in or authorization page, and again if a redirect lands on one", async () => {
    confirm.mockResolvedValueOnce("deny");
    expect(
      await navigateTab(
        {
          op: "navigate",
          url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=1&response_type=code",
          newTab: true,
          mico,
        },
        ui,
      ),
    ).toEqual({ error: "declined" });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "sign_in" }));
    expect(api.tabs.create).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce("timeout");
    expect(
      await navigateTab(
        { op: "navigate", url: "https://login.microsoftonline.com/x", newTab: true, mico },
        ui,
      ),
    ).toEqual({ error: "consent_timeout" });
    // A page that redirects to an identity provider.
    api.tabs.create?.mockImplementationOnce(async ({ url }: { url: string }) => {
      const tab = {
        id: 20,
        windowId: 1,
        url: "https://accounts.google.com/signin?client_id=3&response_type=token",
        title: "Sign in",
        status: "complete",
        incognito: false,
      };
      tabs.set(20, tab);
      void url;
      return tab;
    });
    confirm.mockResolvedValueOnce("deny");
    expect(
      await navigateTab(
        { op: "navigate", url: "https://app.example/start", newTab: true, mico },
        ui,
      ),
    ).toEqual({ error: "declined" });
    expect(api.tabs.remove).toHaveBeenCalledWith(20);
  });

  it("closes a tab it opened if a redirect leads to a refused site", async () => {
    api.tabs.create?.mockImplementationOnce(async () => {
      const tab = {
        id: 30,
        windowId: 1,
        url: "https://www.mycellios.com/agent/app",
        title: "x",
        status: "complete",
        incognito: false,
      };
      tabs.set(30, tab);
      return tab;
    });
    expect(
      await navigateTab(
        { op: "navigate", url: "https://short.example/go", newTab: true, mico },
        ui,
      ),
    ).toEqual({ error: "refused_site" });
    expect(api.tabs.remove).toHaveBeenCalledWith(30);
  });
});
