import { describe, expect, it } from "vitest";
import { BOT_COMPUTER_MODES, BOT_SETTINGS_SECTIONS } from "./bot-settings-layout.js";
import { ComputerModeSchema, CreateBotInput, type ComputerMode } from "./domain.js";

describe("bot settings layout", () => {
  it("offers the isolated computer separately from sharing and This PC", () => {
    const modes: readonly ComputerMode[] = BOT_COMPUTER_MODES;
    expect(modes).toEqual(["isolated", "team", "dedicated"]);
    for (const mode of modes) expect(ComputerModeSchema.parse(mode)).toBe(mode);
  });
  it("defaults new profiles to isolation without rewriting explicit choices", () => {
    expect(CreateBotInput.parse({ name: "New Mico" }).computerMode).toBe("isolated");
    for (const computerMode of ["team", "dedicated"] as const) {
      expect(CreateBotInput.parse({ name: "Existing choice", computerMode }).computerMode).toBe(computerMode);
    }
  });
  it("assigns each control to one section", () => {
    const controls = Object.values(BOT_SETTINGS_SECTIONS).flat();
    expect(new Set(controls).size).toBe(controls.length);
  });
});
