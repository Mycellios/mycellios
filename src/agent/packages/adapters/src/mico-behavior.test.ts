import { expect, it } from "vitest";
import { micoBehaviorInstructions } from "./mico-behavior.js";
import { CONVERSATION_STYLE } from "./conversation-style.js";

it("delivers the current compact default for each run without changing optional plan preferences", () => {
  const text = micoBehaviorInstructions({}, {});
  expect(text).toContain(CONVERSATION_STYLE);
  expect(text).toContain("requests for detail, tutorials, code or complete reports");
  expect(text).toContain("required approvals, costs and unfinished work");
  expect(text).not.toContain("Before a long");
});

it("requests a brief plan only when enabled and never grants action permission", () => {
  expect(micoBehaviorInstructions({}, {})).not.toContain("Before a long");
  const text = micoBehaviorInstructions({ showPlan: true }, {});
  expect(text).toContain("Before a long"); expect(text).toContain("never authorizes"); expect(text).toContain("Do not expose private chain-of-thought");
  expect(micoBehaviorInstructions({ showPlan: true }, { showPlan: false })).not.toContain("Before a long");
});
it("co-author instructions preserve the human author and require authorized commits", () => {
  expect(micoBehaviorInstructions({}, {})).toContain("Only when the user has authorized");
  expect(micoBehaviorInstructions({}, {})).toContain("Keep the user's configured author");
  expect(micoBehaviorInstructions({ gitCoauthor: false }, {})).not.toContain("Co-authored-by:");
});

it("delivers owner preferences to every Mico below its own instructions", () => {
  expect(micoBehaviorInstructions({}, {})).not.toContain("<owner_preferences>");
  expect(micoBehaviorInstructions({ accountInstructions: "  \n " }, {})).not.toContain("<owner_preferences>");
  const text = micoBehaviorInstructions({ accountInstructions: "  Reply in English.\nAlways plan first.  " }, { showPlan: false });
  expect(text).toContain("<owner_preferences>\nReply in English.\nAlways plan first.\n</owner_preferences>");
  expect(text).toContain("unless this Mico's private instructions or the owner's current request say otherwise");
  expect(text).toContain("never authorize an action");
});

it("delivers the chosen style with the same safety and explicit plan preferences", () => {
  const classic = micoBehaviorInstructions({responseStyle: "classic", showPlan: true}, {});
  expect(classic).toContain("Answer directly without announcing setup");
  expect(classic).not.toContain("Before tools, give one short line");
  expect(classic).toContain("Before a long");
  expect(micoBehaviorInstructions({}, {})).toContain("Before tools, give one short line");
});
