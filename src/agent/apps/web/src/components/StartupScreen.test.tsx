// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { StartupScreen } from "./StartupScreen";

describe("startup screen", () => {
  let container: HTMLDivElement | undefined;
  let root: ReturnType<typeof createRoot> | undefined;

  afterEach(() => {
    root?.unmount();
    container?.remove();
  });

  it("paints the green loading avatar before JavaScript and in React", async () => {
    const html = readFileSync(resolve("apps/web/index.html"), "utf8");
    expect(html).toContain("mycellios/loader.svg");
    expect(html).not.toContain("mico.png");
    expect(html).not.toContain("brand-launch-ring");

    const element = document.createElement("div");
    container = element;
    document.body.append(element);
    const mountedRoot = createRoot(element);
    root = mountedRoot;
    await act(async () => {
      mountedRoot.render(<StartupScreen state="session-pending" />);
    });
    expect(element.querySelector(".app-startup")).not.toBeNull();
    expect(element.querySelector(".app-loading-mark img")?.getAttribute("src")).toContain(
      "/mycellios/loader.svg",
    );
    expect(element.innerHTML).not.toContain("mico.png");
  });
});
