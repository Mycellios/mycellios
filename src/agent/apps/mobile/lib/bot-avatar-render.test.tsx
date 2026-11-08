// @vitest-environment jsdom

import { MICO_AVATAR_DEFAULT_SHAPES, MICO_AVATAR_SHAPES } from "@rakazo/contracts";
import { avatarIdentitySeed, micoAvatarArt } from "@rakazo/core";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotAvatar } from "../components/bot-avatar";

vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
  Pressable: ({ children }: { children?: ReactNode }) =>
    createElement("button", { type: "button" }, children),
  Image: ({ source }: { source: { uri: string } }) => createElement("img", { src: source.uri }),
}));

vi.mock("react-native-reanimated", () => {
  const passthrough = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    default: {
      View: passthrough,
      createAnimatedComponent: (component: unknown) => component,
    },
    cancelAnimation: () => undefined,
    Easing: { linear: (value: number) => value, inOut: (value: unknown) => value, cubic: 0 },
    ReduceMotion: { Never: "never" },
    withSpring: (value: unknown) => value,
    useAnimatedProps: () => ({}),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  };
});

vi.mock("react-native-svg", () => {
  const element =
    (tag: string) =>
    ({ children, ...props }: { children?: ReactNode; d?: string }) =>
      createElement(tag, { "data-d": props.d }, children);
  return {
    default: element("svg"),
    Ellipse: element("ellipse"),
    G: element("g"),
    Path: element("path"),
    Rect: element("rect"),
  };
});

vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("./native", () => ({
  useMobileTokens: () => ({ background: "#FFF", workingDot: "#3FA266", secondary: "#7676801F" }),
}));
vi.mock("./i18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));

describe("BotAvatar", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  function render(color: string) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<BotAvatar color={color} identity="bot-1" size={42} />));
    return container;
  }

  const bodies = (view: HTMLElement) =>
    Array.from(view.querySelectorAll("path"), (path) => path.dataset.d);

  it("draws a plain-colour bot with a current mascot for its identity", () => {
    const view = render("#3EC5A8");
    const shape = MICO_AVATAR_DEFAULT_SHAPES[avatarIdentitySeed("bot-1") % MICO_AVATAR_DEFAULT_SHAPES.length]!;
    expect(bodies(view)[0]).toBe(micoAvatarArt(shape.index, "#3EC5A8")!.path);
    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector("rect")).not.toBeNull();
  });

  it("keeps a picture", () => {
    const view = render("data:image/png;base64,abc");
    expect(view.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,abc");
    expect(bodies(view)).toEqual([]);
  });

  it("replaces a legacy shape with its matching current mascot", () => {
    const view = render("#8B5CF6::shape_3");
    expect(bodies(view)).toEqual([micoAvatarArt(MICO_AVATAR_SHAPES[3].index, "#8B5CF6")!.path]);
  });
});
