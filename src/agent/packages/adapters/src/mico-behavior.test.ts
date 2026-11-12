import { expect, it } from "vitest";
import { micoBehaviorInstructions } from "./mico-behavior.js";

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
