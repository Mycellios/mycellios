// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bridge: undefined as unknown,
  whatsapp: {
    links: { list: vi.fn(), setBot: vi.fn(), remove: vi.fn(async () => ({ ok: true })) },
    senders: {
      add: vi.fn(async () => ({})),
      respond: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({ ok: true })),
    },
  },
}));
const api = vi.hoisted(() => ({ whatsapp: mocks.whatsapp }));
vi.mock("../../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("../../lib/desktop", () => ({ whatsappBridge: () => mocks.bridge }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce(
      (text, part, index) => `${text}${index > 0 ? String(values[index - 1]) : ""}${part}`,
      "",
    );
  return { useLingui: () => ({ t }), Trans: ({ children }: { children?: ReactNode }) => children };
});

import { WhatsAppLinkSettings } from "./WhatsAppLinkSettings";

const bots = [
  { id: "bot-1", name: "Chief" },
  { id: "bot-2", name: "Scout" },
];

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    botId: "bot-1",
    botName: "Chief",
    mode: "dedicated",
    phone: "34600111222",
    pushName: "Shop",
    status: "connected",
    desktopDeviceId: "device-1",
    lastSeenAt: null,
    senders: [
      {
        id: "s-pending",
        kind: "contact",
        jid: "34600999888@s.whatsapp.net",
        label: "34600999888",
        status: "pending",
        code: "K7Q2ZP",
        createdAt: "2026-11-21T10:00:00.000Z",
      },
    ],
    groups: [{ jid: "123@g.us", name: "Family" }],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <WhatsAppLinkSettings bots={bots} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found;
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function fakeBridge() {
  let listener: ((statuses: unknown[]) => void) | undefined;
  return {
    available: vi.fn(async () => true),
    status: vi.fn(async () => []),
    link: vi.fn(async () => ({ sessionKey: "session-1" })),
    cancel: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    onStatus: vi.fn((next: (statuses: unknown[]) => void) => {
      listener = next;
      return () => undefined;
    }),
    emit: (statuses: unknown[]) => listener?.(statuses),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.bridge = undefined;
  mocks.whatsapp.links.list.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("explains in a browser that linking needs Desktop", async () => {
  await render();
  const note = container.querySelector('[data-testid="whatsapp-desktop-note"]');
  expect(note?.textContent).toContain("needs Mycellios Desktop");
  expect(note?.querySelector("a")?.getAttribute("href")).toContain("/downloads/desktop");
  expect(container.textContent).not.toContain("Link WhatsApp");
});

it("lists linked numbers and approves a pending request", async () => {
  mocks.whatsapp.links.list.mockResolvedValue([link()]);
  await render();
  expect(container.textContent).toContain("+34600111222");
  expect(container.textContent).toContain("Number only for Mycellios");
  expect(container.textContent).toContain("K7Q2ZP");

  await act(async () => button("Approve").click());
  expect(mocks.whatsapp.senders.respond).toHaveBeenCalledWith({
    senderId: "s-pending",
    accept: true,
  });
});

it("adds an allowed contact by phone number", async () => {
  mocks.whatsapp.links.list.mockResolvedValue([link({ senders: [] })]);
  await render();
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Phone number with country code"]',
  )!;
  await act(async () => setInput(input, "+34 611 222 333"));
  await act(async () => button("Add contact").click());
  expect(mocks.whatsapp.senders.add).toHaveBeenCalledWith({
    linkId: "link-1",
    kind: "contact",
    phone: "34611222333",
  });
});

it("confirms before forgetting a number this PC does not hold", async () => {
  mocks.whatsapp.links.list.mockResolvedValue([link({ status: "logged_out" })]);
  await render();
  expect(container.textContent).toContain("14 days offline");
  await act(async () => button("Disconnect").click());
  expect(mocks.whatsapp.links.remove).not.toHaveBeenCalled();
  expect(container.textContent).toContain("WhatsApp → Linked devices");
  const confirm = [...container.querySelectorAll('[role="group"] button')].find(
    (candidate) => candidate.textContent === "Disconnect",
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  expect(mocks.whatsapp.links.remove).toHaveBeenCalledWith({ linkId: "link-1" });
});

it("links through the Desktop bridge and shows the QR step", async () => {
  const bridge = fakeBridge();
  mocks.bridge = bridge;
  await render();
  expect(container.querySelector('[data-testid="whatsapp-desktop-note"]')).toBeNull();

  await act(async () => button("Link WhatsApp").click());
  expect(container.textContent).toContain("can restrict or block a number");
  const dedicated = [...container.querySelectorAll("label")].find((label) =>
    label.textContent?.includes("A number only for Mycellios"),
  )!;
  await act(async () => dedicated.click());
  await act(async () => button("Show QR code").click());
  expect(bridge.link).toHaveBeenCalledWith({ botId: "bot-1", mode: "dedicated", method: "qr" });

  await act(async () =>
    bridge.emit([{ sessionKey: "session-1", state: "qr", qr: "2@abc,def,ghi" }]),
  );
  const session = container.querySelector('[data-testid="whatsapp-link-session"]');
  expect(session?.textContent).toContain("Link a device and scan this code");
  expect(session?.querySelector('canvas[aria-label="WhatsApp link code"]')).not.toBeNull();

  await act(async () =>
    bridge.emit([{ sessionKey: "session-1", state: "connected", linkId: "link-1" }]),
  );
  expect(container.textContent).toContain("Linked. Open");
});

it("cancels an open linking session through the bridge", async () => {
  const bridge = fakeBridge();
  mocks.bridge = bridge;
  await render();
  await act(async () => button("Link WhatsApp").click());
  const personal = [...container.querySelectorAll("label")].find((label) =>
    label.textContent?.includes("My personal number"),
  )!;
  await act(async () => personal.click());
  await act(async () => button("Show QR code").click());
  await act(async () => button("Cancel").click());
  expect(bridge.cancel).toHaveBeenCalledWith("session-1");
});
