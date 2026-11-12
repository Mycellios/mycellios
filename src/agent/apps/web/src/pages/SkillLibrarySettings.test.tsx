// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ agentSkills: { list: vi.fn() } }));
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => api }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));
import { SkillLibrarySettings } from "./SkillLibrarySettings";

it("loads visible skills on entry once, even with a fresh translation function", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.agentSkills.list.mockResolvedValue([{ id: "research", name: "Research", description: "Find sources" }]);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SkillLibrarySettings />));
    expect(host.textContent).toContain("Research");
    expect(host.querySelector('[data-slot="collapsible-trigger"]')).toBeNull();
    expect(api.agentSkills.list).toHaveBeenCalledOnce();
    await act(async () => root.render(<SkillLibrarySettings />));
    expect(api.agentSkills.list).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
