// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ status: vi.fn(), enter: vi.fn(), chat: vi.fn(), config: vi.fn(), eligible: vi.fn(() => true) }));
vi.mock("../../lib/guest-chat", async original => ({
  ...(await original<typeof import("../../lib/guest-chat")>()),
  guestApi: { status: f.status, enter: f.enter, chat: f.chat, config: f.config },
  guestChatEligible: f.eligible,
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (i < v.length ? String(v[i]) : ""), "") }),
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@mycellios/ui-web", () => ({
  Button: ({ size: _size, variant: _variant, ...props }: Record<string, unknown>) => <button {...props} />,
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));
vi.mock("../../lib/rpc", () => { throw new Error("guest chat must not load the authenticated RPC client"); });
vi.mock("../Shell", () => { throw new Error("guest chat must not mount Shell"); });

import { GuestChat } from "./GuestChat";
import { GuestEntry } from "./GuestEntry";
import { GuestChatRequestError } from "../../lib/guest-chat";

const limits = { messagesPerSession: 12, messageChars: 4000, historyMessages: 8, historyBytes: 24_576 };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); localStorage.clear();
  f.eligible.mockReturnValue(true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  Element.prototype.scrollTo = () => {};
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = async (path = "/", element = <GuestChat limits={limits} />) => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/" element={element} />
    <Route path="/sign-up" element={<p>sign-up page</p>} />
    <Route path="/sign-in" element={<p>sign-in page</p>} />
  </Routes></MemoryRouter>));
};
const type = async (text: string) => {
  const area = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async () => { await act(async () => { host.querySelector("form")!.requestSubmit(); }); };
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label);

it("starts a session on the first message, streams the answer and never renders remote images", async () => {
  f.status.mockResolvedValue(null);
  f.enter.mockResolvedValue({ remaining: 12, limit: 12, expiresAt: Date.now() + 1000 });
  f.chat.mockImplementation(async (_input, onText) => {
    onText("Hola");
    return { status: "completed", content: "Hola ![pixel](https://evil.invalid/p.png) [docs](https://docs.invalid)", remaining: 2 };
  });
  await render();
  expect(host.querySelector("[data-guest-notice]")?.textContent).toContain("Do not share sensitive information");
  await type("¿Qué es Mycellios?");
  await submit();
  expect(f.enter).toHaveBeenCalledTimes(1);
  const input = f.chat.mock.calls[0]![0];
  expect(input.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(input.messages).toEqual([{ role: "user", content: "¿Qué es Mycellios?" }]);
  expect(host.querySelector('[data-role="user"]')?.textContent).toBe("¿Qué es Mycellios?");
  const answer = host.querySelector('[data-role="assistant"]')!;
  expect(answer.textContent).toContain("Hola pixel");
  expect(answer.querySelector("img")).toBeNull();
  expect(host.innerHTML).not.toContain("evil.invalid");
  const link = answer.querySelector("a")!;
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(link.getAttribute("rel")).toContain("noreferrer");
  expect(host.querySelector("[data-guest-remaining]")?.textContent).toBe("2 free guest messages left");
  // A reload in the same tab keeps the conversation.
  expect(JSON.parse(sessionStorage.getItem("mycellios:guest:chat")!).messages).toHaveLength(2);
  await act(async () => root.unmount()); root = createRoot(host);
  f.status.mockResolvedValue({ remaining: 2, limit: 12, expiresAt: Date.now() + 1000 });
  await render();
  expect(host.querySelectorAll("[data-role]")).toHaveLength(2);
});

it("offers an account when the guest limit is reached and keeps the transcript", async () => {
  f.status.mockResolvedValue({ remaining: 1, limit: 12, expiresAt: Date.now() + 1000 });
  f.chat.mockRejectedValue(new GuestChatRequestError("guest_session_limit_reached"));
  await render();
  await type("una más"); await submit();
  expect(f.enter).not.toHaveBeenCalled();
  expect(host.querySelector('[data-guest-alert="guest_session_limit_reached"]')).not.toBeNull();
  expect(host.querySelector("textarea")!.disabled).toBe(true);
  expect(host.querySelector('[data-role="user"]')?.textContent).toBe("una más");
  await act(async () => button("Create a free account")!.click());
  expect(host.textContent).toContain("sign-up page");
});

it("lets the visitor retry the same message after a busy refusal, and asks for an account for files", async () => {
  f.status.mockResolvedValue({ remaining: 5, limit: 12, expiresAt: Date.now() + 1000 });
  f.chat.mockRejectedValueOnce(new GuestChatRequestError("guest_busy"))
    .mockResolvedValueOnce({ status: "completed", content: "ya", remaining: 4 });
  await render();
  await type("hola"); await submit();
  expect(host.querySelector('[data-guest-alert="guest_busy"]')).not.toBeNull();
  await act(async () => button("Try again")!.click());
  expect(f.chat.mock.calls[1]![0]).toEqual(f.chat.mock.calls[0]![0]);
  expect(host.querySelector('[data-role="assistant"]')?.textContent).toBe("ya");
  await act(async () => button("Attach a file")!.click());
  expect(host.querySelector('[data-guest-alert="guest_needs_account"]')).not.toBeNull();
  expect(f.chat).toHaveBeenCalledTimes(2);
});

it("shows the welcome page for deep links, native hosts, a disabled coordinator or a failed read", async () => {
  const welcome = <GuestEntry fallback={<p>welcome page</p>} />;
  f.config.mockResolvedValue({ enabled: true, limits, challenge: { token: "t", difficulty: 8, expiresAt: 0 } });
  f.status.mockResolvedValue(null);
  await render("/?task=abc", welcome);
  expect(host.textContent).toContain("welcome page");
  expect(f.config).not.toHaveBeenCalled();
  f.eligible.mockReturnValue(false);
  await render("/", welcome);
  expect(host.textContent).toContain("welcome page");
  f.eligible.mockReturnValue(true);
  f.config.mockResolvedValueOnce({ enabled: false });
  await act(async () => root.unmount()); root = createRoot(host);
  await render("/", welcome);
  expect(host.textContent).toContain("welcome page");
  f.config.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.unmount()); root = createRoot(host);
  await render("/", welcome);
  expect(host.textContent).toContain("welcome page");
  await act(async () => root.unmount()); root = createRoot(host);
  await render("/", welcome);
  await vi.waitFor(() => expect(host.querySelector("[data-guest-chat]")).not.toBeNull());
});
