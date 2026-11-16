// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OnboardingTeamMember } from "./create-onboarding-team";
import { TeamCreditsError } from "./team-catalog";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button {...props} />
  ),
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  Disclosure: ({ summary, children }: { summary: ReactNode; children: ReactNode }) => <details><summary>{summary}</summary>{children}</details>,
}));

import { TeamBuilder } from "./TeamBuilder";

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

async function render(
  onCreate: (members: OnboardingTeamMember[]) => Promise<void> = vi.fn(
    async (_members: OnboardingTeamMember[]) => undefined,
  ),
  onUseProvider: (members: OnboardingTeamMember[] | null) => void = vi.fn(),
) {
  await act(async () => {
    root.render(<TeamBuilder onCreate={onCreate} onUseProvider={onUseProvider} onSingleMico={async () => undefined} />);
  });
  return { onCreate, onUseProvider };
}

function click(name: string) {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === name || item.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`Missing ${name}`);
  act(() => button.click());
}

async function clickAsync(name: string) {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === name || item.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`Missing ${name}`);
  await act(async () => button.click());
}

function fill(value: string) {
  const field = host.querySelector("textarea");
  if (!field) throw new Error("Missing description");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("uses explicit answers to create a team without classifying free-form text", async () => {
  const onCreate = vi.fn(async (_members: OnboardingTeamMember[]) => undefined);
  await render(onCreate);
  expect(host.querySelector("h1")?.textContent).toBe("What should your team handle?");
  expect(host.querySelectorAll("button").length).toBeGreaterThan(6);
  const submit = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "Continue",
  ) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fill("Find new sales leads");
  click("Continue");
  expect(host.textContent).toContain("Which role is closest?");
  click("Sales");
  click("Continue");
  expect(host.textContent).toContain("Who is this for?");
  click("Just me");
  click("Continue");
  expect(host.textContent).toContain("What should they do first?");
  click("Draft work for me to review");
  click("Continue");
  expect(host.textContent).toContain("Lead Researcher");
  expect(host.textContent).toContain("Outreach Writer");
  expect(host.textContent).toContain("Follow-up");
  expect(host.textContent).toContain("Use your model or start with Mycellios credits");
  expect(host.textContent).toContain("Creating your team uses no credits");
  await clickAsync("Create and open this team");
  expect(onCreate).toHaveBeenCalledTimes(1);
  const members = onCreate.mock.calls[0]![0];
  expect(members.map((member) => member.name)).toEqual([
    "Lead Researcher",
    "Outreach Writer",
    "Follow-up",
  ]);
  expect(members[0]?.lead).toBe(true);
  expect(members[0]?.instructions).toContain("Find new sales leads");
});

it("creates a gallery role in one click and offers a provider when credits are unavailable", async () => {
  const onCreate = vi.fn(async (_members: OnboardingTeamMember[]) => {
    throw new TeamCreditsError();
  });
  const onUseProvider = vi.fn();
  await render(onCreate, onUseProvider);
  await clickAsync("Create and open this team: SEO");
  expect(onCreate.mock.calls[0]![0].map((member) => member.id)).toEqual([
    "seo-research",
    "seo-editor",
    "seo-technical",
  ]);
  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("No credits were spent");
  act(() => alert?.querySelector("button")?.click());
  expect(onUseProvider).toHaveBeenCalledWith(onCreate.mock.calls[0]![0]);
});

it("asks which role is closest when the description does not name one", async () => {
  await render();
  fill("Help me get organized");
  click("Continue");
  expect(host.textContent).toContain("Which role is closest?");
  click("Support");
  click("Continue");
  expect(host.textContent).toContain("Who is this for?");
});
