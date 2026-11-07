// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcClient } from "../lib/rpc";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
import { MicoTaskTabs } from "./MicoTaskTabs";

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; });

describe("Mico task navigation", () => {
  it("closes the active tab without removing its conversation from the thread list", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    const select = vi.fn();
    const list = vi.fn().mockResolvedValue([{ threadId: "task-1", title: "Independent work" }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    const render = (threadId?: string) => root.render(<MicoTaskTabs botId="mico" scope="test-mico"
      taskThreadId={threadId} rpc={rpc} onSelect={select} />);
    await act(async () => render("task-1"));
    expect(list).toHaveBeenCalledWith({ botId: "mico" });
    const task = host.querySelector<HTMLButtonElement>('button[aria-current="page"]')!;
    expect(task.textContent).toBe("Independent work");
    expect(task.getAttribute("aria-current")).toBe("page");
    await act(() => task.click());
    expect(select).toHaveBeenCalledWith("task-1");
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close tab"]')!.click());
    expect(select).toHaveBeenLastCalledWith(undefined);
    await act(() => render());
    expect(host.querySelector('button[title="Independent work"]')).toBeNull();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Mico tasks"]')!.click());
    const reopen = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Independent work")!;
    await act(() => reopen.click());
    expect(select).toHaveBeenLastCalledWith("task-1");
  });

  it("discards a previous Mico's late list response after changing scope", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    let finish!: (rows: { threadId: string; title: string }[]) => void;
    const list = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce([{ threadId: "b-task", title: "Mico B work" }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs key="a" scope="test-a" botId="a" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => root.render(<MicoTaskTabs key="b" scope="test-b" botId="b" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => finish([{ threadId: "a-task", title: "Stale Mico A work" }]));
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Mico tasks"]')!.click());
    expect(document.body.textContent).toContain("Mico B work");
    expect(document.body.textContent).not.toContain("Stale Mico A work");
  });
});
