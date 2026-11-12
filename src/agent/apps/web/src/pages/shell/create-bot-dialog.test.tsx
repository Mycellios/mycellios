// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { productBrand } from "@rakazo/contracts";
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

function shapeButton(id: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find(element => element.querySelector(`[data-mico-shape="${id}"]`));
  if (!found) throw new Error(`No mycelium shape ${id}`);
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
  it("shows the inline first-Mico form and creates only after confirmation", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await act(async () => root.render(<CreateBotDialog inline onCreate={onCreate} />));
    const setup = document.querySelector('[data-testid="first-mico-setup"]');
    expect(setup?.querySelector("input")?.value).toBe(productBrand.companionName);
    expect(setup?.querySelector('[data-mascot="mushroom"] [data-mico-avatar="plush"][data-mico-shape="mushroom"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
    await click(button("Create Mico"));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: productBrand.companionName });
  });

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
    expect(document.querySelector('[data-mascot="mushroom"] [data-mico-avatar="plush"][data-mico-shape="mushroom"]')).not.toBeNull();
    await typeName("Scout");
    await click(button("Create"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Scout" });
  });

  it("uses the mushroom when choosing a color before a shape", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await render(onCreate);
    await click(button("Turquoise"));
    await typeName("Scout");
    await click(button("Create"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Scout", color: "#28A99E::shape_2001" });
  });

  it("saves the purpose as instructions when creating the Mico", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await render(onCreate);
    await typeName("Scout");
    const purpose = document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(purpose, "  Plan trips  ");
      purpose.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Create"));
    expect(onCreate).toHaveBeenCalledWith({
      name: "Scout",
      description: "Plan trips",
      instructions: "Plan trips",
    });
  });

  it("sends a custom shape and palette together", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await render(onCreate);
    await click(shapeButton("sprout"));
    await click(button("Turquoise"));
    await typeName("Scout");
    await click(button("Create"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Scout", color: "#28A99E::shape_4001" });
  });

  it.each([true, false])("uses a suggestion as an editable draft (inline: %s)", async (inline) => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await act(async () => root.render(<CreateBotDialog inline={inline} onCreate={onCreate} />));

    const suggestion = button("Trip planner");
    await click(suggestion);
    expect(onCreate).not.toHaveBeenCalled();
    expect(suggestion.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Name your Bot"]')?.value).toBe("Trip planner");

    await typeName("Train planner");
    expect(suggestion.getAttribute("aria-pressed")).toBe("false");
    await click(button(inline ? "Create Mico" : "Create"));

    const purpose = "Compare routes, accommodation and budgets, and build practical itineraries for my trips.";
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      name: "Train planner",
      color: "#6863E8::shape_1102",
      description: purpose,
      instructions: purpose,
    });
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
    expect(button("Original colors").getAttribute("aria-pressed")).toBe("false");
    expect(button("Velvety").getAttribute("aria-pressed")).toBe("true");

    await click(button("Mint"));
    expect(onChange).toHaveBeenLastCalledWith("#67B793::shape_2001");
    await renderStudio(onChange.mock.lastCall![0]);
    await click(shapeButton("weave"));
    expect(onChange).toHaveBeenLastCalledWith("#67B793::shape_4321");
    expect(button("Upload").getAttribute("role")).toBe("tab");
    await renderStudio(onChange.mock.lastCall![0]);
    await click(shapeButton("crest"));
    await renderStudio(onChange.mock.lastCall![0]);
    expect(shapeButton("crest").getAttribute("aria-pressed")).toBe("true");
    expect(button("Mint").getAttribute("aria-pressed")).toBe("true");
    expect((button("Velvety") as HTMLButtonElement).disabled).toBe(false);
    await click(shapeButton("weave"));

    await renderStudio(onChange.mock.lastCall![0]);
    await click(button("Star"));
    await renderStudio(onChange.mock.lastCall![0]);
    await click(button("Flat"));
    await renderStudio(onChange.mock.lastCall![0]);
    await click(button("Wine"));
    await renderStudio(onChange.mock.lastCall![0]);
    expect(shapeButton("weave").getAttribute("aria-pressed")).toBe("true");
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
    expect(shapeButton("weave").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-mico-avatar="plush"] image')?.getAttribute("filter")).toBeNull();
  });
});

it("creates from a purpose alone with an automatic name and instructions", async () => {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  await render(onCreate);
  const textarea = document.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Prepare weekly budgets"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(onCreate).not.toHaveBeenCalled();
  await click(button("Create"));
  expect(onCreate).toHaveBeenCalledWith({ name: productBrand.companionName, description: "Prepare weekly budgets", instructions: "Prepare weekly budgets" });
});
