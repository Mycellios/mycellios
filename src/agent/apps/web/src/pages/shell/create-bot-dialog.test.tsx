// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateBotDialogInput } from "./create-bot-dialog";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray | { message: string }, ...values: unknown[]) =>
    "message" in parts
      ? parts.message
      : parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { AvatarStudioPopover } from "./avatar-studio-popover";
import { CreateBotDialog } from "./create-bot-dialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(onCreate: (input: CreateBotDialogInput) => Promise<void>) {
  await act(async () => {
    root.render(<CreateBotDialog onCancel={() => undefined} onCreate={onCreate} />);
  });
}

function button(name: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === name || element.textContent === name,
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
}

async function typeName(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Name your Bot"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

describe("CreateBotDialog", () => {
  it("creates only once the name is not blank", async () => {
    const onCreate = vi.fn(async () => undefined);
    await render(onCreate);
    expect(button("Create").disabled).toBe(true);
    await typeName("   ");
    expect(button("Create").disabled).toBe(true);
    await typeName("  Scout  ");
    expect(button("Create").disabled).toBe(false);
  });

  it("lets the server assign an unused avatar by default", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await render(onCreate);
    await typeName("Scout");
    await click(button("Create"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Scout" });
  });

  it("sends a custom shape and palette together", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await render(onCreate);
    await click(button("Fox"));
    await click(button("Turquoise"));
    await typeName("Scout");
    await click(button("Create"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Scout", color: "#28A99E::shape_2033" });
  });

  it("shows the error and stays open when creating fails", async () => {
    await render(async () => {
      throw new Error("Bot limit reached");
    });
    await typeName("Scout");
    await click(button("Create"));
    expect(document.querySelector('[data-testid="create-bot-error"]')?.textContent).toBe(
      "Bot limit reached",
    );
    expect(document.querySelector('[data-testid="create-bot-dialog"]')).not.toBeNull();
  });
});

describe("importing instead", () => {
  it("offers Import only when the parent handles it", async () => {
    await render(async () => undefined);
    expect(document.querySelector('[data-testid="create-bot-import"]')).toBeNull();

    const onImport = vi.fn();
    await act(async () => {
      root.render(
        <CreateBotDialog
          onCancel={() => undefined}
          onCreate={async () => undefined}
          onImport={onImport}
        />,
      );
    });
    await act(async () => button("Import").click());
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});

describe("Mico avatar settings", () => {
  it("changes shape and palette separately and keeps the upload option available", async () => {
    const onChange = vi.fn();
    const renderStudio = (value: string) =>
      act(async () => root.render(<AvatarStudioPopover value={value} onChange={onChange} />));
    await renderStudio("#8650DF::shape_1000");
    await click(button("Customize bot avatar"));
    expect(button("Mushroom").getAttribute("aria-pressed")).toBe("true");
    expect(button("Original colors").getAttribute("aria-pressed")).toBe("true");
    expect(button("Velvety").getAttribute("aria-pressed")).toBe("true");

    await click(button("Mint"));
    expect(onChange).toHaveBeenLastCalledWith("#67B793::shape_2001");
    await renderStudio(onChange.mock.lastCall![0]);
    await click(button("Octopus"));
    expect(onChange).toHaveBeenLastCalledWith("#67B793::shape_2353");
    expect(button("Upload").getAttribute("role")).toBe("tab");

    await renderStudio(onChange.mock.lastCall![0]);
    await click(button("Star"));
    await renderStudio(onChange.mock.lastCall![0]);
    await click(button("Flat"));
    await renderStudio(onChange.mock.lastCall![0]);
    await click(button("Wine"));
    await renderStudio(onChange.mock.lastCall![0]);
    expect(button("Octopus").getAttribute("aria-pressed")).toBe("true");
    expect(button("Wine").getAttribute("aria-pressed")).toBe("true");
    expect(button("Star").getAttribute("aria-pressed")).toBe("true");
    expect(button("Flat").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-mico-avatar="flat"]')).not.toBeNull();
    await click(button("Velvety"));
    await renderStudio(onChange.mock.lastCall![0]);
    expect(document.querySelector('[data-mico-avatar="plush"] image')).not.toBeNull();
    await click(button("Original colors"));
    await renderStudio(onChange.mock.lastCall![0]);
    expect(button("Star").getAttribute("aria-pressed")).toBe("true");
    expect(button("Octopus").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-mico-avatar="plush"] image')?.getAttribute("filter")).toBeNull();
  });
});
