// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invites = vi.hoisted(() => ({ preview: vi.fn(), accept: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { spaces: { invites } } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@mycellios/ui-web", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
      <button type="button" {...props} />
    ),
    Skeleton: Box,
    Dialog: Box,
    DialogContent: Box,
    DialogTitle: Box,
  };
});

import {
  forgetInviteToken,
  joinedSpacePath,
  SpaceInvitePage,
  takeInviteToken,
} from "./SpaceInvite";

const token = "fake_token_0123456789abcdefghijklmnopqrstuv";
let container: HTMLDivElement;
let root: Root;
let location = "";

function Where() {
  const current = useLocation();
  location = `${current.pathname}${current.search}`;
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", `/join#${token}`);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  forgetInviteToken();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function show(signedIn: boolean) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/join"]}>
        <Routes>
          <Route path="/join" element={<SpaceInvitePage signedIn={signedIn} />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

it("keeps a valid token from the fragment for this tab only, and nothing else", () => {
  const storage = new Map<string, string>();
  const tab = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  } as unknown as Storage;
  expect(takeInviteToken("#not-a-token", tab)).toBeNull();
  expect(takeInviteToken(`#${token}`, tab)).toBe(token);
  expect(takeInviteToken("", tab)).toBe(token);
  forgetInviteToken(tab);
  expect(takeInviteToken("", tab)).toBeNull();
  expect(joinedSpacePath("space-launch")).toBe("/app?settings=space-members&space=space-launch");
});

it("asks a signed-out visitor to sign in and returns to the invitation", async () => {
  await show(false);
  expect(window.location.hash).toBe("");
  expect(container.textContent).toContain("Sign in to accept this invitation.");
  expect(invites.preview).not.toHaveBeenCalled();
  await act(async () => button("Sign in").click());
  expect(location).toBe("/sign-in?next=join");
});

it("shows who invited a signed-in account and joins on request", async () => {
  invites.preview.mockResolvedValue({
    spaceId: "space-launch",
    spaceName: "Launch",
    ownerName: "Ana",
    invitedBy: "Ben",
    expiresAt: "2026-12-02T00:00:00.000Z",
    member: false,
  });
  invites.accept.mockResolvedValue({ spaceId: "space-launch" });
  await show(true);
  expect(invites.preview).toHaveBeenCalledWith({ token }, { context: { spaceId: null } });
  expect(container.querySelector("h1")?.textContent).toBe("Launch");
  expect(container.textContent).toContain("Invited by Ben");
  // Members' turns run on the owner's Credits, so the invitation says the owner can read them.
  expect(container.textContent).toContain("Ana can read your conversations with their Micos.");
  await act(async () => button("Join").click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(invites.accept).toHaveBeenCalledWith({ token }, { context: { spaceId: null } });
  expect(location).toBe("/app?settings=space-members&space=space-launch");
  expect(takeInviteToken("")).toBeNull();
});

it("opens a Space the account already belongs to without joining again", async () => {
  invites.preview.mockResolvedValue({
    spaceId: "space-launch",
    spaceName: "Launch",
    ownerName: "Ana",
    invitedBy: "Ana",
    expiresAt: "2026-12-02T00:00:00.000Z",
    member: true,
  });
  await show(true);
  expect(container.textContent).toContain("You are already in this space.");
  expect(container.textContent).not.toContain("can read your conversations");
  await act(async () => button("Open").click());
  expect(invites.accept).not.toHaveBeenCalled();
  expect(location).toBe("/app?settings=space-members&space=space-launch");
});

it("explains an invitation that cannot be opened", async () => {
  invites.preview.mockRejectedValue(new Error("This invitation is for another email address."));
  await show(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "This invitation is for another email address.",
  );
  await act(async () => button("Not now").click());
  expect(location).toBe("/app");
});
