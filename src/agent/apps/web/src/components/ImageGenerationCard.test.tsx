// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ src: null as string | null, download: vi.fn() }));
vi.mock("../lib/use-artifact-image", () => ({ useArtifactImage: () => mocks.src }));
vi.mock("../lib/artifact-open", () => ({ downloadArtifact: mocks.download }));
vi.mock("@lingui/react/macro", () => {
  const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import type { MessageBlock } from "@mycellios/contracts";
import { generatedImageArtifactIds, ImageGenerationCard } from "./ImageGenerationCard";

type Block = Extract<MessageBlock, { kind: "image_generation" }>;
const target = { botId: "bot" };
let cleanup: (() => void) | undefined;

function mount(block: Block) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ImageGenerationCard block={block} target={target} name="fox.png" />));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  mocks.src = null;
  mocks.download.mockReset();
});

it("reserves the requested shape while generating", () => {
  const container = mount({
    kind: "image_generation",
    status: "generating",
    aspectRatio: "portrait",
    prompt: "a fox in snow",
  });
  const card = container.querySelector("section");
  expect(card?.dataset.status).toBe("generating");
  expect(card?.getAttribute("aria-live")).toBe("polite");
  expect(container.querySelector<HTMLElement>(".rk-image-gen-stage")?.style.aspectRatio).toBe(
    "3 / 4",
  );
  expect(container.textContent).toContain("Generating image");
  expect(container.textContent).toContain("a fox in snow");
  expect(container.querySelector("img")).toBeNull();
});

it("shows the finished picture with its size, download and preview", async () => {
  mocks.src = "blob:fox";
  const container = mount({
    kind: "image_generation",
    status: "completed",
    aspectRatio: "landscape",
    artifactId: "artifact",
    width: 1536,
    height: 1024,
  });
  const image = container.querySelector("img");
  expect(image?.getAttribute("src")).toBe("blob:fox");
  Object.defineProperty(image, "naturalWidth", { value: 1536 });
  Object.defineProperty(image, "naturalHeight", { value: 1024 });
  act(() => image?.dispatchEvent(new Event("load")));
  expect(container.querySelector<HTMLElement>(".rk-image-gen-stage")?.style.aspectRatio).toBe(
    "1536 / 1024",
  );
  expect(container.textContent).toContain("1536 × 1024");
  const download = container.querySelector<HTMLButtonElement>('[aria-label="Download image"]');
  await act(async () => download?.click());
  expect(mocks.download).toHaveBeenCalledWith(target, "artifact", "fox.png", "image/png");
});

it("explains a failed or stopped generation", () => {
  const container = mount({
    kind: "image_generation",
    status: "failed",
    aspectRatio: "square",
    error: "Sign in to Codex on your computer.",
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Sign in to Codex on your computer.",
  );
  cleanup?.();
  const stopped = mount({ kind: "image_generation", status: "interrupted", aspectRatio: "square" });
  expect(stopped.textContent).toContain("Image generation stopped");
  expect(stopped.querySelector('[role="alert"]')?.textContent).toBe("The image was not finished.");
});

it("lists only completed cards' artifacts for the duplicate image block", () => {
  expect(
    generatedImageArtifactIds([
      { kind: "image_generation", status: "completed", aspectRatio: "square", artifactId: "a" },
      { kind: "image_generation", status: "failed", aspectRatio: "square" },
      { kind: "image", artifactId: "a", mimeType: "image/png", name: "a.png" },
    ]),
  ).toEqual(new Set(["a"]));
});
