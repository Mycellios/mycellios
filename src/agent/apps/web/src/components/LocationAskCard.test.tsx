// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
}));
vi.mock("@mycellios/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../lib/rpc", () => ({ rpc: {} }));

import type { AskBlock } from "./AskCard";
import { AskCard } from "./AskCard";

let root: Root;
let container: HTMLDivElement;

const pending: AskBlock = {
  kind: "ask",
  text: "To find restaurants near you.",
  status: "pending",
  location: {},
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "geolocation");
});

function stubGeolocation(getCurrentPosition: Geolocation["getCurrentPosition"]) {
  const geolocation = { getCurrentPosition: vi.fn(getCurrentPosition), watchPosition: vi.fn() };
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: geolocation });
  return geolocation;
}

async function render(
  block: AskBlock,
  onAnswer = vi.fn(async (_text: string) => undefined),
  isRunUser = true,
) {
  await act(async () =>
    root.render(
      <AskCard
        block={block}
        canAnswer
        canDismiss={false}
        isRunUser={isRunUser}
        onAnswer={onAnswer}
        onDismiss={async () => undefined}
      />,
    ),
  );
  return onAnswer;
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(label),
  );
}

async function click(element: Element | undefined) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Let the position lookup and the answer promise settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("reads the position only when Share location is clicked, once, and sends it rounded", async () => {
  const geolocation = stubGeolocation((success) =>
    success({
      coords: { latitude: 40.416775, longitude: -3.70379, accuracy: 25 },
    } as GeolocationPosition),
  );
  const onAnswer = await render(pending);
  expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();

  await click(button("Share location"));

  expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  expect(geolocation.watchPosition).not.toHaveBeenCalled();
  expect(JSON.parse(onAnswer.mock.calls[0]![0])).toEqual({
    kind: "position",
    latitude: 40.417,
    longitude: -3.704,
    accuracyMeters: 100,
  });
  expect(container.textContent).toContain("Location shared");
});

it("explains a denied permission and keeps typing a place available", async () => {
  stubGeolocation((_success, failure) =>
    failure?.({ code: 1, message: "denied" } as GeolocationPositionError),
  );
  const onAnswer = await render(pending);

  await click(button("Share location"));

  expect(onAnswer).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Location access is off. Type a place instead.",
  );
  expect(container.querySelector('input[aria-label="Place"]')).not.toBeNull();
});

it("sends a typed place without touching the device position", async () => {
  const geolocation = stubGeolocation(() => undefined);
  const onAnswer = await render(pending);
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Place"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Gran Via, Madrid",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(JSON.parse(onAnswer.mock.calls[0]![0])).toEqual({
    kind: "place",
    place: "Gran Via, Madrid",
  });
  expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

it("sends a refusal without touching the device position", async () => {
  const geolocation = stubGeolocation(() => undefined);
  const onDecline = await render(pending);
  await click(button("Don't share"));
  expect(JSON.parse(onDecline.mock.calls[0]![0])).toEqual({ kind: "declined" });
  expect(container.textContent).toContain("Not shared");
  expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
});

it("offers only typing where the browser has no geolocation, and nothing to other members", async () => {
  await render(pending);
  expect(button("Share location")).toBeUndefined();
  expect(container.querySelector('input[aria-label="Place"]')).not.toBeNull();

  await render(pending, undefined, false);
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(0);
});

it("shows an answered card without the location", async () => {
  await render({ ...pending, status: "answered", answer: "", location: { outcome: "typed" } });
  expect(container.textContent).toBe("To find restaurants near you.Location shared");
});
