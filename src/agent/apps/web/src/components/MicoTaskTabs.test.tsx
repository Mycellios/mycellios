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
  it("opens only the selected task and leaves the primary chat available", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    const select = vi.fn();
    const list = vi.fn().mockResolvedValue([{ threadId: "task-1", title: "Independent work" }]);
    await act(async () => root.render(<MicoTaskTabs botId="mico" taskThreadId="task-1" rpc={{ development: { list } } as unknown as RpcClient} onSelect={select} />));
    expect(list).toHaveBeenCalledWith({ botId: "mico" });
    const task = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Independent work")!;
    expect(task.getAttribute("aria-current")).toBe("page");
    await act(() => task.click());
    expect(select).toHaveBeenCalledWith("task-1");
    const main = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Main chat")!;
    await act(() => main.click());
    expect(select).toHaveBeenLastCalledWith();
  });

  it("discards a previous Mico's late list response after changing scope", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    let finish!: (rows: { threadId: string; title: string }[]) => void;
    const list = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce([{ threadId: "b-task", title: "Mico B work" }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs key="a" botId="a" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => root.render(<MicoTaskTabs key="b" botId="b" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => finish([{ threadId: "a-task", title: "Stale Mico A work" }]));
    expect(host.textContent).toContain("Mico B work");
    expect(host.textContent).not.toContain("Stale Mico A work");
  });
});
