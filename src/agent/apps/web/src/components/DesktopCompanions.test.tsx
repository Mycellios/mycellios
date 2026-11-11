// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot, RakazoDesktop } from "@rakazo/contracts";
const fixture = vi.hoisted(() => ({ avatar: vi.fn(), navigate: vi.fn() }));
vi.mock("../lib/companion-avatar", () => ({ companionAvatar: fixture.avatar }));
vi.mock("react-router-dom", () => ({ useNavigate: () => fixture.navigate }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join(""), i18n: { locale: "en" } }) }));
import { DesktopCompanions } from "./DesktopCompanions";
it("revokes the old account before avatar loading and rejects a late snapshot from that account", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const publish = vi.fn(async (_snapshot: unknown) => undefined);
  window.rakazoDesktop = { companions: { publish, onSelect: () => () => {} } } as unknown as RakazoDesktop;
  let oldAvatar!: (image: undefined) => void;
  fixture.avatar.mockImplementationOnce(() => new Promise(resolve => { oldAvatar = resolve; })).mockResolvedValue(undefined);
  const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
  const bot = { id: "mico", spaceId: "space", name: "Mico", color: "#3f9f78", status: "idle", preview: "", unread: false } as Bot;
  const oldScope = JSON.stringify(["old-owner", "space"]), newScope = JSON.stringify(["new-owner", "space"]);
  try {
    await act(async () => root.render(<DesktopCompanions bots={[bot]} spaceId="space" scope={oldScope} />));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ scope: oldScope, agents: [] }));
    publish.mockClear();
    await act(async () => root.render(<DesktopCompanions bots={[bot]} spaceId="space" scope={newScope} />));
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ scope: newScope, agents: [] });
    await act(async () => oldAvatar(undefined));
    expect(publish.mock.calls.every(([snapshot]) => (snapshot as any).scope === newScope)).toBe(true);
  } finally {
    await act(async () => root.unmount()); div.remove(); delete window.rakazoDesktop; vi.unstubAllGlobals();
  }
});
