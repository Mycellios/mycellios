// @vitest-environment jsdom

import type { ChatModelChoice } from "@rakazo/core";
import type { PopoverContent } from "@rakazo/ui-web/components/ui/popover";
import type { ComponentProps, ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatModelPicker } from "./chat-model-picker";

const { popoverProps } = vi.hoisted(() => ({ popoverProps: vi.fn() }));

vi.mock("@rakazo/ui-web/components/ui/popover", async (importOriginal) => {
  const actual = await importOriginal<{ PopoverContent: typeof PopoverContent }>();
  return {
    ...actual,
    PopoverContent: (props: ComponentProps<typeof PopoverContent>) => {
      popoverProps(props);
      return createElement(actual.PopoverContent, props);
    },
  };
});

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

function choices(count: number): ChatModelChoice[] {
  return [
    { key: "", label: "Space default" },
    ...Array.from({ length: count }, (_, index) => ({
      key: `openrouter::vendor/model-${index + 1}`,
      label: `Model ${index + 1} (OpenRouter)`,
      provider: "openrouter",
      providerLabel: "OpenRouter",
      modelLabel: `Model ${index + 1}`,
      modelId: `vendor/model-${index + 1}`,
    })),
  ];
}

describe("ChatModelPicker", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = () => undefined;
    onChange.mockReset();
    popoverProps.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (list: ChatModelChoice[], value: string) =>
    act(() =>
      root.render(<ChatModelPicker id="model" choices={list} value={value} onChange={onChange} />),
    );
  const options = () => [...document.querySelectorAll('[role="option"]')];
  const search = (text: string) =>
    act(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("groups distributed capacity before AntSeed without changing the selected model", async () => {
    const list = [
      { key: "openai-compatible::external", label: "External (Mycellios)", title: "External", provider: "openai-compatible", providerLabel: "Mycellios", modelId: "external" },
      { key: "openai-compatible::network", label: "Network (Mycellios)", title: "Network", provider: "openai-compatible", providerLabel: "Mycellios", modelId: "network" },
    ];
    act(() => root.render(<ChatModelPicker id="model" inline choices={list} value={list[0]!.key} onChange={onChange}
      modelOrigins={{ [list[0]!.key]: "antseed", [list[1]!.key]: "network" }} />));
    expect([...container.querySelectorAll("[cmdk-group-heading]")].map(node => node.textContent)).toEqual(["Mycellios network", "AntSeed"]);
    expect(options().map(node => node.getAttribute("aria-label"))).toEqual(["Network (Mycellios)", "External (Mycellios)"]);
    expect(options()[1]?.getAttribute("data-checked")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
    search("Network");
    expect(options()).toHaveLength(1);
    await act(async () => (options()[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(list[1]!.key);
  });

  it("uses the themed menu for a short list and preserves the inherited option", async () => {
    render(choices(9), "openrouter::vendor/model-1");
    const trigger = container.querySelector<HTMLButtonElement>("button#model")!;
    expect(trigger.textContent).toBe("Model 1 (OpenRouter)");
    await act(async () => trigger.click());
    expect(options()).toHaveLength(10);
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    await act(async () => (options()[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  });

  it("keeps the empty own-network section above external models without adding a selectable placeholder", async () => {
    const list = [{ key: "openai-compatible::external", label: "External (Mycellios)", provider: "openai-compatible", providerLabel: "Mycellios", modelId: "external" }];
    act(() => root.render(<ChatModelPicker id="model" inline choices={list} value={list[0]!.key} onChange={onChange}
      modelOrigins={{ [list[0]!.key]: "antseed" }} />));
    const network = container.querySelector('[cmdk-group]')!;
    expect([...container.querySelectorAll("[cmdk-group-heading]")].map(node => node.textContent)).toEqual(["Mycellios network", "AntSeed"]);
    expect(network.hasAttribute("hidden")).toBe(false);
    expect(network.textContent).toContain("No chat models available right now.");
    expect(options().map(node => node.getAttribute("aria-label"))).toEqual(["External (Mycellios)"]);
    expect(onChange).not.toHaveBeenCalled();
    search("External");
    expect([...container.querySelectorAll("[cmdk-group-heading]")].map(node => node.textContent)).toEqual(["AntSeed"]);
    expect(options()).toHaveLength(1);
    await act(async () => (options()[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(list[0]!.key);
  });

  it("does not claim an empty network while discovery is pending or unsuccessful", () => {
    const list = [{ key: "openai-compatible::external", label: "External (Mycellios)", provider: "openai-compatible", providerLabel: "Mycellios", modelId: "external" }];
    act(() => root.render(<ChatModelPicker id="model" inline choices={list} value={list[0]!.key} onChange={onChange}
      mycelliosCatalogReady={false} modelOrigins={{ [list[0]!.key]: "antseed" }} />));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(options()).toHaveLength(1);
  });

  it("does not add an empty Mycellios group to other providers", () => {
    act(() => root.render(<ChatModelPicker id="model" inline choices={choices(3)} value="openrouter::vendor/model-1" onChange={onChange}
      modelOrigins={{}} />));
    expect(container.textContent).not.toContain("Mycellios network");
    expect(container.textContent).not.toContain("No chat models available right now.");
  });

  it("marks a short list's selected model when it cannot read images", () => {
    const list = choices(2).map((choice, index) =>
      index === 1 ? { ...choice, images: false } : { ...choice, images: true },
    );
    render(list, "openrouter::vendor/model-1");
    const select = container.querySelector("button#model")!;
    const hint = () => document.getElementById(select.getAttribute("aria-describedby") ?? "");
    expect(container.querySelector('[title="Can\'t read images"]')).not.toBeNull();
    expect(hint()?.textContent).toBe("Can't read images");

    render(list, "openrouter::vendor/model-2");
    expect(container.querySelector('[title="Can\'t read images"]')).toBeNull();
    expect(select.hasAttribute("aria-describedby")).toBe(false);
  });

  it("marks text-only rows and the selected model in a long list", () => {
    const list = choices(11).map((choice) =>
      choice.modelId === "vendor/model-3" ? { ...choice, images: false } : choice,
    );
    render(list, "openrouter::vendor/model-3");
    const trigger = container.querySelector<HTMLButtonElement>("button#model")!;
    expect(trigger.querySelector('[title="Can\'t read images"]')).not.toBeNull();
    act(() => trigger.click());
    const marked = options().filter((option) =>
      option.querySelector('[title="Can\'t read images"]'),
    );
    expect(marked.map((option) => option.textContent)).toEqual(["Model 3"]);
    expect(marked[0]?.getAttribute("aria-describedby")).toBe(
      trigger.getAttribute("aria-describedby"),
    );
  });

  it("searches a long list by name or id and picks from it", () => {
    render(choices(11), "openrouter::vendor/model-2");
    expect(container.querySelector("select")).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>("button#model")!;
    expect(trigger.textContent).toBe("Model 2 (OpenRouter)");

    act(() => trigger.click());
    expect(options()).toHaveLength(12);
    expect(document.querySelector("[cmdk-group-heading]")?.textContent).toBe("OpenRouter");
    expect(options()[2]?.getAttribute("aria-label")).toBe("Model 2 (OpenRouter)");
    const checked = options().filter((option) => option.getAttribute("data-checked") === "true");
    expect(checked.map((option) => option.textContent)).toEqual(["Model 2"]);

    search("MODEL 1");
    expect(options().map((option) => option.textContent)).toEqual([
      "Model 1",
      "Model 10",
      "Model 11",
    ]);
    search("vendor/model-7");
    expect(options().map((option) => option.textContent)).toEqual(["Model 7"]);

    act(() => (options()[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("openrouter::vendor/model-7");
    expect(options()).toHaveLength(0);
  });

  it("folds older models under one row, marks new ones and shows all while searching", () => {
    const list = choices(11).map((choice, index): ChatModelChoice => {
      if (index === 1) return { ...choice, listing: "new" };
      if (index >= 9) return { ...choice, listing: "older" };
      return choice;
    });
    render(list, "openrouter::vendor/model-10");
    act(() => container.querySelector<HTMLButtonElement>("button#model")!.click());
    const labels = () => options().map((option) => option.getAttribute("aria-label"));
    // Model 10 is older but selected, so it stays; Models 9 and 11 fold.
    expect(labels()).not.toContain("Model 11 (OpenRouter)");
    expect(labels()).toContain("Model 10 (OpenRouter)");
    expect(labels().at(-1)).toBe("Older models");
    expect(options().at(-1)?.textContent).toBe("Older models2");
    expect(options()[1]?.textContent).toBe("Model 1New");

    search("Model 11");
    expect(labels()).toEqual(["Model 11 (OpenRouter)"]);
    search("");
    act(() => (options().at(-1) as HTMLElement).click());
    expect(labels()).toContain("Model 11 (OpenRouter)");
    expect(options().at(-1)?.getAttribute("aria-expanded")).toBe("true");
    act(() => (options().at(-1) as HTMLElement).click());
    expect(labels()).not.toContain("Model 11 (OpenRouter)");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says when nothing matches", () => {
    render(choices(11), "");
    act(() => container.querySelector<HTMLButtonElement>("button#model")!.click());
    search("no such model");
    expect(options()).toHaveLength(0);
    expect(document.querySelector("[cmdk-group-heading]")).toBeNull();
    expect(document.body.textContent).toContain("No matching models");
  });

  it("lets the popup flip vertically without switching axes", () => {
    render(choices(11), "");
    act(() => container.querySelector<HTMLButtonElement>("button#model")!.click());
    expect(popoverProps.mock.lastCall?.[0]).toMatchObject({
      side: "bottom",
      align: "start",
      collisionAvoidance: { side: "flip", align: "shift", fallbackAxisSide: "none" },
    });
  });
});
