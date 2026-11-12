// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Disclosure, ExpandedSettings } from "./disclosure";
import { createPortal } from "react-dom";

it("keeps child state and effects alive while folding and reopening", async () => {
  const mounted = vi.fn();
  const cleanup = vi.fn();
  function Content() {
    useEffect(() => {
      mounted();
      return cleanup;
    }, []);
    return <input aria-label="Draft" defaultValue="Original" />;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <Disclosure summary="Advanced" defaultOpen onOpenChange={onOpenChange}>
        <Content />
      </Disclosure>,
    );
  });
  const trigger = container.querySelector("button")!;
  const input = container.querySelector("input")!;
  input.value = "Unsaved edit";
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(cleanup).not.toHaveBeenCalled();
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector("input")).toBe(input);
  expect(input.value).toBe("Unsaved edit");
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([false, true]);
  await act(async () => root.unmount());
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("reveals collapsed content when browser Find matches it", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <Disclosure summary="Advanced" onOpenChange={onOpenChange}>
        <p>Searchable content</p>
      </Disclosure>,
    );
  });
  const trigger = container.querySelector("button")!;
  const panel = container.querySelector('[data-slot="collapsible-content"]')!;
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(panel.getAttribute("hidden")).toBe("until-found");
  await act(async () => panel.dispatchEvent(new Event("beforematch")));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true]);
  await act(async () => root.unmount());
});
it.each(["context", "explicit"])("settings sections stay visible without a collapse control (%s)", async mode => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const onOpenChange = vi.fn();
  const section = <Disclosure summary="Notifications by Mico" alwaysVisible={mode === "explicit"} open={false} onOpenChange={onOpenChange}><input aria-label="Editable setting" defaultValue="Draft" /></Disclosure>;
  try {
    await act(async () => root.render(mode === "context" ? <ExpandedSettings>{section}</ExpandedSettings> : section));
    expect(container.querySelector("h3")?.textContent).toBe("Notifications by Mico");
    expect(container.querySelector("button,[hidden],[aria-expanded]")).toBeNull();
    const input = container.querySelector("input")!; input.value = "Unsaved edit";
    await act(async () => root.render(mode === "context" ? <ExpandedSettings>{section}</ExpandedSettings> : section));
    expect(container.querySelector("input")?.value).toBe("Unsaved edit"); expect(onOpenChange).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); }
});
it("carries visible settings into portalled subpanels without changing disclosures outside Settings", async () => {
 const container = document.createElement("div"), portal = document.createElement("div"); document.body.append(container,portal); const root = createRoot(container);
 try {
  await act(async () => root.render(<><Disclosure summary="Chat details"><p>Chat content</p></Disclosure><ExpandedSettings>{createPortal(<Disclosure summary="MCP options"><input aria-label="Private key" type="password" /></Disclosure>,portal)}</ExpandedSettings></>));
  expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  expect(portal.querySelector("h3")?.textContent).toBe("MCP options"); expect(portal.querySelector("button,[hidden]")).toBeNull();
  expect(portal.querySelector("input")?.type).toBe("password");
 } finally { await act(async()=>root.unmount()); container.remove(); portal.remove(); }
});
