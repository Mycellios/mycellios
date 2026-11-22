// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
import { ThreadLinkChip } from "./ThreadLinkChip";

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

describe("conversation link", () => {
  it("names the conversation and opens it in its Mico", async () => {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(() => root!.render(<MemoryRouter initialEntries={["/app/mico"]}>
      <Routes><Route path="*" element={<><ThreadLinkChip botId="mico" threadId="plan" title="Plan the trip" /><Where /></>} /></Routes>
    </MemoryRouter>));
    const link = host.querySelector<HTMLButtonElement>('[data-testid="thread-link"]')!;
    expect(link.textContent).toBe("Open conversation Plan the trip");
    await act(() => link.click());
    expect(host.querySelector('[data-testid="where"]')!.textContent).toBe("/app/mico?task=plan");
  });

  it("stays readable outside the app's router", async () => {
    const host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(() => root!.render(<ThreadLinkChip botId="mico" threadId="plan" title="" />));
    expect(host.textContent).toBe("Open conversation New conversation");
    expect(host.querySelector("button")).toBeNull();
  });
});
