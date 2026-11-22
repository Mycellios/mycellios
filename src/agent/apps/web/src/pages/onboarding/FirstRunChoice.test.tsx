// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@mycellios/ui-web", () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button {...props} />
  ),
  BotAvatar: ({ identity }: { identity: string }) => <span data-testid="avatar" data-identity={identity} />,
  cn: (...names: unknown[]) => names.filter(Boolean).join(" "),
  Spinner: (props: ComponentProps<"span">) => <span role="status" {...props} />,
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: { checked: boolean; onCheckedChange: (checked: boolean) => void } & ComponentProps<"input">) => (
    <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} {...props} />
  ),
}));
vi.mock("../../components/ProviderLogo", () => ({
  ProviderLogo: ({ providerId }: { providerId: string }) => <span data-provider={providerId} />,
}));

import { FirstRunChoice } from "./FirstRunChoice";

const host = document.createElement("div");
let root: Root;

beforeEach(() => {
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: Partial<ComponentProps<typeof FirstRunChoice>> = {}) {
  const handlers = {
    onStartFree: vi.fn(),
    onUsePlan: vi.fn(),
    onAnalyticsChange: vi.fn(),
  };
  act(() => root.render(<FirstRunChoice analytics={false} {...handlers} {...props} />));
  return handlers;
}
const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

it("offers free models as the recommendation beside a subscription, with the team and legal links", () => {
  const handlers = render();
  expect(host.querySelector("h1")?.textContent).toBe("Create your AI team.");
  expect(host.querySelectorAll('[data-testid="avatar"]').length).toBeGreaterThan(3);
  expect(button("Use free models").textContent).toContain("Recommended");
  expect(button("Use my AI subscription").querySelectorAll("[data-provider]")).toHaveLength(2);
  act(() => button("Use free models").click());
  expect(handlers.onStartFree).toHaveBeenCalledOnce();
  act(() => button("Use my AI subscription").click());
  expect(handlers.onUsePlan).toHaveBeenCalledOnce();
  const links = [...host.querySelectorAll("a")].map((link) => link.getAttribute("href"));
  expect(links).toEqual(["https://www.mycellios.com/terms", "https://www.mycellios.com/privacy"]);
});

it("keeps analytics opt-in and reports the user's choice", () => {
  const handlers = render();
  const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(box.checked).toBe(false);
  act(() => box.click());
  expect(handlers.onAnalyticsChange).toHaveBeenCalledWith(true);
});

it("shows progress and blocks both rows while the free start runs", () => {
  render({ loading: true });
  expect(button("Use free models").disabled).toBe(true);
  expect(button("Use my AI subscription").disabled).toBe(true);
  expect(host.querySelector('[role="status"]')).not.toBeNull();
});

it("shows why the free start failed and links it to the row", () => {
  render({ error: "Mycellios could not start right now. Try again." });
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toBe("Mycellios could not start right now. Try again.");
  expect(button("Use free models").getAttribute("aria-describedby")).toContain(alert.id);
});
