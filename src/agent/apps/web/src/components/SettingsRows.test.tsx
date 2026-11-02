// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsRow } from "./SettingsRows";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((out, part, index) => out + part + (values[index] ?? ""), "") }),
}));

it("opens help without toggling the setting and preserves the clickable label", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    await act(async () => root.render(<SettingsRow
      label={<label htmlFor="stream-setting">Stream replies</label>}
      help={{ label: "Stream replies", description: "Shows the reply as it is written." }}
      control={<input id="stream-setting" type="checkbox" onChange={change} />}
    />));
    const help = host.querySelector<HTMLButtonElement>('button[aria-label="About Stream replies"]')!;
    expect(help.closest("label")).toBeNull();
    await act(async () => help.click());
    expect(host.querySelector<HTMLInputElement>("input")?.checked).toBe(false);
    expect(change).not.toHaveBeenCalled();
    expect(document.getElementById(help.getAttribute("aria-describedby")!)?.textContent).toContain("Shows the reply");
    await act(async () => host.querySelector("label")!.click());
    expect(host.querySelector<HTMLInputElement>("input")?.checked).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
