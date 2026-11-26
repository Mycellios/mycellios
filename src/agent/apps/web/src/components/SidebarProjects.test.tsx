// @vitest-environment jsdom
import type { ProjectSummary } from "@mycellios/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { RpcClient } from "../lib/rpc";
import { SidebarProjects } from "./SidebarProjects";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }),
}));

function project(name: string, numberOfChats: number): ProjectSummary {
  return { id: name, name, conversations: Array.from({ length: numberOfChats }, (_, index) => {
    const title = `${name} ${index + 1}`;
    return { botId: name, threadId: title, title, unread: true };
  }) };
}

it("warms the intended folder before opening it while another read is still pending", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const complete = new Map<string, () => void>();
  const warm = vi.fn((_botId: string, threadId: string) =>
    new Promise<void>(resolve => complete.set(threadId, resolve)));
  const select = vi.fn();
  try {
    await act(() => root.render(<SidebarProjects projects={[project("First", 3), project("Second", 8)]}
      rpc={{} as RpcClient} bots={[]} creating={false} onCreating={() => undefined} onRefresh={() => undefined}
      onSelect={select} onWarm={warm} failed={false} />));
    expect(warm.mock.calls).toEqual([["First", "First 1"], ["First", "First 2"]]);
    expect(select).not.toHaveBeenCalled();

    const secondFolder = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Second")!;
    await act(() => secondFolder.focus());
    expect(secondFolder.getAttribute("aria-expanded")).toBe("false");
    expect(warm).toHaveBeenCalledTimes(2);
    await act(() => complete.get("First 1")!());
    expect(warm).toHaveBeenLastCalledWith("Second", "Second 1");
    expect(select).not.toHaveBeenCalled();
    await act(() => secondFolder.click());
    await act(() => complete.get("First 2")!());
    expect(warm).toHaveBeenLastCalledWith("Second", "Second 2");

    for (let index = 1; index <= 5; index += 1) {
      await act(() => complete.get(`Second ${index}`)!());
    }
    expect(warm.mock.calls.slice(2)).toEqual(
      Array.from({ length: 5 }, (_, index) => ["Second", `Second ${index + 1}`]),
    );

    const laterChat = host.querySelector<HTMLButtonElement>('button[title="Second 8"]')!;
    await act(() => laterChat.focus());
    expect(warm).toHaveBeenLastCalledWith("Second", "Second 8");
    await act(() => laterChat.click());
    expect(select).toHaveBeenCalledWith("Second", "Second 8");
    await act(() => complete.get("Second 8")!());
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
