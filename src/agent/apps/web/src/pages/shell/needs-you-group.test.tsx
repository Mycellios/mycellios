// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const { tag } = vi.hoisted(() => ({
  tag: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ""), ""),
}));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: tag, i18n: { locale: "en" } }) }));
vi.mock("@lingui/core/macro", () => ({ t: tag }));
vi.mock("../../lib/sidebar-sections", () => ({ useSidebarSectionCollapsed: () => [false, () => undefined] }));
import { NeedsYouGroup } from "./needs-you-group";

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });

it("shows the question a Mico waits on and how long it has waited", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ now: new Date("2026-11-27T10:00:00.000Z") });
  const openSpaceChat = vi.fn();
  const chat = (id: string, extra: Record<string, unknown>) => ({ kind: "bot" as const, chat: { id, spaceId: "space", name: id, ...extra } });
  const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
  try {
    await act(async () => root.render(<NeedsYouGroup openSpaceChat={openSpaceChat} groups={[{ bots: [
      chat("Nico", { status: "waiting_input", waitingQuestion: "Which photo for the spring cover?", waitingSince: "2026-11-27T09:43:00.000Z" }),
      chat("Clara", { status: "waiting_input", waitingSince: "2026-11-27T07:00:00.000Z" }),
    ] }]} />));
    const [nico, clara] = [...el.querySelectorAll("button[data-needs-you]")];
    expect(nico?.textContent).toContain("Which photo for the spring cover?");
    expect(nico?.textContent).toContain("17m ago");
    expect(nico?.getAttribute("aria-label")).toBe("Answer: Nico. Which photo for the spring cover?");
    expect(clara?.textContent).toContain("Waiting for your answer");
    expect(clara?.textContent).toContain("3h ago");
    await act(async () => (nico as HTMLButtonElement).click());
    expect(openSpaceChat).toHaveBeenCalledWith("space", "/app/Nico?respond=1");
  } finally { await act(async () => root.unmount()); }
});
