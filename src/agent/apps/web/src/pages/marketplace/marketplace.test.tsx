// @vitest-environment jsdom

import type { Bot } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  history: vi.fn(),
  restore: vi.fn(),
  pin: vi.fn(),
  remove: vi.fn(),
}));
const botsApi = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("../../lib/space-rpc", () => ({
  useSpaceRpc: () => ({ agentSkills: api, bots: botsApi }),
  useBoundSpaceId: () => null,
}));
vi.mock("../../lib/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/query")>()),
  useSpaceQueries: () => ({
    agentSkills: {
      list: {
        queryOptions: () => ({ queryKey: ["marketplace-skills"], queryFn: () => api.list() }),
      },
    },
  }),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((s, part, index) => s + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    variant: _v,
    size: _s,
    render: _r,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string; render?: ReactNode }) => (
    <button {...props} />
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
  NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  BotAvatar: () => <span aria-hidden="true" />,
  BOT_AVATAR_COLORS: ["#a855f7", "#0d9488"],
}));

import { AgentsMarketplace } from "./AgentsMarketplace";
import {
  appCategory,
  groupByCategory,
  MICO_TEMPLATES,
  marketplaceTab,
  recipeContent,
  SKILL_RECIPES,
  templateInstructions,
} from "./catalog";
import { SkillsMarketplace } from "./SkillsMarketplace";

const skill = {
  id: "skill-a",
  name: "Change Review",
  description: "Owned instructions",
  source: "user" as const,
  readOnly: false,
  revision: 2,
  content: "---\nname: Change Review\ndescription: Owned instructions\n---\n\nOriginal",
  createdAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-04T00:00:00Z",
};
const bot = {
  id: "bot-a",
  name: "Mico A",
  title: "",
  description: "",
  pinned: true,
  color: null,
} as unknown as Bot;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: QueryClient;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.list.mockResolvedValue([skill]);
  api.get.mockResolvedValue(skill);
  api.history.mockResolvedValue([skill, { ...skill, revision: 1 }]);
  api.pin.mockResolvedValue({ ok: true });
  api.remove.mockResolvedValue({ ok: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  cache.clear();
  vi.unstubAllGlobals();
});
async function tick() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function show(node: ReactNode) {
  await act(async () =>
    root.render(<QueryClientProvider client={cache}>{node}</QueryClientProvider>),
  );
  await tick();
}
function button(label: string, scope: ParentNode = host) {
  const match = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
}
async function click(label: string, scope: ParentNode = host) {
  await act(async () => button(label, scope).click());
  await tick();
}
async function field(el: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

it("uses one category per real app and bounds unknown tabs to Apps", () => {
  expect(appCategory("GOOGLE_SHEETS")).toBe("data");
  expect(appCategory("supabase")).toBe("code");
  expect(appCategory("not-a-known-app")).toBe("other");
  expect(appCategory("constructor")).toBe("other");
  expect(
    groupByCategory(["github", "figma", "unknown"], appCategory).flatMap((group) => group.items),
  ).toHaveLength(3);
  expect(marketplaceTab("settings")).toBe("apps");
  expect(marketplaceTab("skills")).toBe("skills");
  expect(marketplaceTab("webs")).toBe("mycellios-apps");
});
it("every template has real bounded instructions and every guide has a unique installable recipe", () => {
  expect(new Set(SKILL_RECIPES.map((recipe) => recipe.name)).size).toBe(SKILL_RECIPES.length);
  for (const template of MICO_TEMPLATES) {
    expect(templateInstructions(template).length).toBeLessThan(20000);
    for (const id of template.skills)
      expect(SKILL_RECIPES.some((recipe) => recipe.id === id)).toBe(true);
  }
  expect(recipeContent(SKILL_RECIPES[0]!)).toContain("---\nname: Change Review");
});
it("shows saved skills once and opens their real content and version history", async () => {
  await show(<SkillsMarketplace bots={[bot]} />);
  expect(host.querySelectorAll("strong").length).toBe(SKILL_RECIPES.length);
  expect(
    [...host.querySelectorAll("strong")].filter((el) => el.textContent === "Change Review"),
  ).toHaveLength(1);
  await click("Open");
  expect(api.get).toHaveBeenCalledWith({ skillId: "skill-a" });
  expect(api.history).toHaveBeenCalledWith({ skillId: "skill-a" });
  expect(host.querySelector("textarea")!.value).toBe(skill.content);
});
it("preserves expected revision on edits and uses the composer's shared query cache", async () => {
  const changed = { ...skill, revision: 3, content: `${skill.content} changed` };
  api.update.mockResolvedValue(changed);
  await show(<SkillsMarketplace bots={[bot]} />);
  await click("Open");
  await field(host.querySelector("textarea")!, changed.content);
  await click("Save");
  expect(api.update).toHaveBeenCalledWith({
    skillId: "skill-a",
    expectedRevision: 2,
    content: changed.content,
  });
  expect(api.create).not.toHaveBeenCalled();
  expect(cache.getQueryData(["marketplace-skills"])).toEqual([skill]);
  expect(host.textContent).toContain("Saved");
});
it("keeps an unsaved draft and the old revision when the server rejects an edit", async () => {
  api.update.mockRejectedValue(new Error("Another editor changed the skill"));
  await show(<SkillsMarketplace bots={[]} />);
  await click("Open");
  await field(host.querySelector("textarea")!, "my changed draft");
  await click("Save");
  expect(host.querySelector("textarea")!.value).toBe("my changed draft");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Another editor");
});
it("pins an exact historical version or follows latest for the chosen Mico", async () => {
  await show(<SkillsMarketplace bots={[bot]} />);
  await click("Open");
  await field(host.querySelector("select")!, "bot-a");
  await click("Use current version");
  expect(api.pin).toHaveBeenLastCalledWith({ skillId: "skill-a", botId: "bot-a", revision: 2 });
  await click("Follow latest");
  expect(api.pin).toHaveBeenLastCalledWith({ skillId: "skill-a", botId: "bot-a", revision: null });
  const historical = [...host.querySelectorAll("li")].find((el) =>
    el.textContent?.includes("Version 1"),
  )!;
  await click("Use for agent", historical);
  expect(api.pin).toHaveBeenLastCalledWith({ skillId: "skill-a", botId: "bot-a", revision: 1 });
});
it("requires confirmation for deletion and does not expose writes for a readonly skill", async () => {
  await show(<SkillsMarketplace bots={[]} />);
  await click("Open");
  await click("Delete");
  expect(api.remove).not.toHaveBeenCalled();
  await click("Confirm delete");
  expect(api.remove).toHaveBeenCalledWith({ skillId: "skill-a" });
  api.get.mockResolvedValue({ ...skill, readOnly: true });
  await click("Open");
  expect(host.querySelector("textarea")!.readOnly).toBe(true);
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).not.toContain("Delete");
});
it("creates a Mico with editable template instructions, reusing the nonce after an uncertain response", async () => {
  const created = vi.fn();
  botsApi.create
    .mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockResolvedValueOnce(bot);
  await show(
    <AgentsMarketplace
      bots={[]}
      scope="account/space"
      onCreated={created}
      onOpen={vi.fn()}
      onChanged={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((el) => el.textContent?.includes("Research Desk"))!
      .click(),
  );
  await click("Add Mico");
  expect(created).not.toHaveBeenCalled();
  await click("Add Mico");
  expect(botsApi.create.mock.calls[0]![0].spawnKey).toBe(botsApi.create.mock.calls[1]![0].spawnKey);
  expect(botsApi.create.mock.calls[1]![0].instructions).toContain("existing permissions");
  expect(created).toHaveBeenCalledWith(bot);
});

it("disables writes until the saved skill catalog refresh completes", async () => {
  let finish!: (rows: (typeof skill)[]) => void;
  const pending = new Promise<(typeof skill)[]>((resolve) => {
    finish = resolve;
  });
  api.list.mockResolvedValueOnce([skill]).mockReturnValueOnce(pending);
  api.update.mockResolvedValue({ ...skill, revision: 3 });
  await show(<SkillsMarketplace bots={[]} />);
  await click("Open");
  await field(host.querySelector("textarea")!, "changed content");
  await click("Save");
  expect(button("Save").disabled).toBe(true);
  await act(async () => finish([{ ...skill, revision: 3 }]));
  await tick();
  expect(cache.getQueryData(["marketplace-skills"])).toEqual([{ ...skill, revision: 3 }]);
});
