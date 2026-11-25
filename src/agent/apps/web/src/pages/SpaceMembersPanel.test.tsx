// @vitest-environment jsdom

import type { SpaceInvitationCreated, SpaceMembers } from "@mycellios/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const members = vi.hoisted(() => ({
  audit: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  setRole: vi.fn(),
  leave: vi.fn(),
}));
const invites = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn() }));
vi.mock("../lib/rpc", () => {
  const client = { spaces: { members, invites } };
  return {
    rpc: client,
    rpcForSpace: () => client,
    createSpaceRpc: () => client,
    selectedSpaceId: () => null,
  };
});
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t, i18n: { date: (value: Date) => value.toISOString().slice(0, 10) } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@mycellios/ui-web", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & {
      variant?: string;
      size?: string;
    }) => <button type="button" {...props} />,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    NativeSelect: ({ size: _size, ...props }: ComponentProps<"select"> & { size?: string }) => (
      <select {...props} />
    ),
    NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
    AlertDialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogContent: Box,
    AlertDialogHeader: Box,
    AlertDialogFooter: Box,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button">{children}</button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
      disabled,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Skeleton: Box,
    Dialog: Box,
    DialogContent: Box,
    DialogTitle: Box,
  };
});

vi.mock("./SpaceMicosPanel", () => ({ SpaceMicosPanel: () => null }));

import { SpaceMembersPanel } from "./SpaceMembersPanel";

const ownerView: SpaceMembers = {
  spaceId: "space-launch",
  role: "owner",
  limit: 20,
  people: [
    {
      userId: "ana",
      name: "Ana",
      email: "ana@example.test",
      role: "owner",
      joinedAt: "2026-11-01T00:00:00.000Z",
      you: true,
    },
    {
      userId: "ben",
      name: "Ben",
      email: "ben@example.test",
      role: "member",
      joinedAt: "2026-11-02T00:00:00.000Z",
      you: false,
    },
  ],
  invitations: [
    {
      id: "invite-1",
      kind: "email",
      email: "cai@example.test",
      invitedBy: "Ana",
      createdAt: "2026-11-20T00:00:00.000Z",
      expiresAt: "2026-11-27T00:00:00.000Z",
    },
  ],
};
const linkInvite: SpaceInvitationCreated = {
  invitation: {
    id: "invite-2",
    kind: "link",
    email: null,
    invitedBy: "Ana",
    createdAt: "2026-11-25T00:00:00.000Z",
    expiresAt: "2026-12-02T00:00:00.000Z",
  },
  url: "https://app.example.test/join#fake_token_0123456789abcdefghijklmnopqrstuv",
  emailSent: false,
};

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function show(onLeft = vi.fn()) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <SpaceMembersPanel spaceName="Launch" onLeft={onLeft} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return onLeft;
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label || item.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

it("loads the Space activity only when opened and requests earlier events by cursor", async () => {
  members.list.mockResolvedValue(ownerView);
  const event = {
    type: "space.mico.shared", actorName: "Ana", targetName: null,
    role: null, kind: null, micoName: "Writer", createdAt: "2026-11-25T00:00:00.000Z",
  };
  members.audit.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => ({
    ...event, id: `event-${index}`,
  }))).mockResolvedValueOnce([{ ...event, id: "older", micoName: "Reader" }]);
  await show();
  expect(members.audit).not.toHaveBeenCalled();
  await click("Show activity");
  expect(container.textContent).toContain("Changed Mico sharing");
  expect(container.textContent).toContain("Writer");
  await click("Load earlier activity");
  expect(members.audit).toHaveBeenLastCalledWith({ cursor: "event-49", limit: 50 });
  expect(container.textContent).toContain("Reader");
  expect(container.textContent).not.toContain("Load earlier activity");
});

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

it("lets the owner invite by link, copy it, change a role, remove a member and revoke", async () => {
  members.list.mockResolvedValue(ownerView);
  invites.create.mockResolvedValue(linkInvite);
  members.setRole.mockResolvedValue({
    ...ownerView,
    people: [ownerView.people[0]!, { ...ownerView.people[1]!, role: "admin" }],
  });
  members.remove.mockResolvedValue({ ...ownerView, people: [ownerView.people[0]!] });
  invites.revoke.mockResolvedValue({ ...ownerView, invitations: [] });
  await show();

  expect(container.textContent).toContain("Ana");
  expect(container.textContent).toContain("Owner");
  expect(container.textContent).toContain("Expires 2026-11-27");
  expect(container.querySelectorAll("select")).toHaveLength(1);
  expect(container.textContent).not.toContain("Leave space");

  await click("Create link");
  expect(invites.create).toHaveBeenCalledWith({ kind: "link" });
  const link = container.querySelector<HTMLInputElement>('[aria-label="Invite link"]');
  expect(link?.value).toBe(linkInvite.url);
  await click("Copy link");
  expect(writeText).toHaveBeenCalledWith(linkInvite.url);

  const role = container.querySelector<HTMLSelectElement>('[aria-label="Role"]')!;
  await act(async () => {
    role.value = "admin";
    role.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  expect(members.setRole).toHaveBeenCalledWith({ userId: "ben", role: "admin" });

  await click("Remove Ben");
  expect(members.remove).toHaveBeenCalledWith({ userId: "ben" });
  expect(container.textContent).not.toContain("ben@example.test");

  await click("Revoke");
  expect(invites.revoke).toHaveBeenCalledWith({ invitationId: "invite-1" });
});

it("invites by email and offers the link only when the email was not sent", async () => {
  members.list.mockResolvedValue({ ...ownerView, invitations: [] });
  invites.create
    .mockResolvedValueOnce({
      ...linkInvite,
      invitation: { ...linkInvite.invitation, kind: "email", email: "cai@example.test" },
      emailSent: true,
    })
    .mockResolvedValueOnce({
      ...linkInvite,
      invitation: { ...linkInvite.invitation, kind: "email", email: "dan@example.test" },
      emailSent: false,
    });
  await show();
  const email = container.querySelector<HTMLInputElement>('[aria-label="Email address"]')!;
  const type = async (value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(email, value);
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  await type("cai@example.test");
  await click("Invite");
  expect(invites.create).toHaveBeenLastCalledWith({ kind: "email", email: "cai@example.test" });
  expect(container.querySelector('[aria-label="Invite link"]')).toBeNull();

  await type("dan@example.test");
  await click("Invite");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Invite link"]')?.value).toBe(
    linkInvite.url,
  );
  expect(container.textContent).toContain("Email not sent. Share the link instead.");
});

it("shows a member the people without invite, role or remove controls, and lets them leave", async () => {
  members.list.mockResolvedValue({
    ...ownerView,
    role: "member",
    people: [ownerView.people[0]!, { ...ownerView.people[1]!, you: true }].map((person) =>
      person.userId === "ana" ? { ...person, you: false } : person,
    ),
    invitations: [],
  });
  members.leave.mockResolvedValue({ ok: true });
  const onLeft = await show();
  expect(container.querySelector('[aria-label="Email address"]')).toBeNull();
  expect(container.querySelector("select")).toBeNull();
  expect(() => button("Remove Ana")).toThrow();
  expect(container.textContent).toContain("Member");

  await click("Leave space");
  expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Leave Launch?");
  await click("Leave");
  expect(members.leave).toHaveBeenCalledOnce();
  expect(onLeft).toHaveBeenCalledOnce();
});

it("shows why an invitation could not be created", async () => {
  members.list.mockResolvedValue({ ...ownerView, invitations: [] });
  invites.create.mockRejectedValue(new Error("This space is full."));
  await show();
  await click("Create link");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("This space is full.");
});
