import { expect, it } from "vitest";
import { hostedFrameAttributes } from "./hosted-web-files";

it("keeps the default frame exactly as sandboxed as before", () => {
  expect(hostedFrameAttributes(undefined)).toEqual({ sandbox: "allow-scripts" });
  expect(hostedFrameAttributes([])).toEqual({ sandbox: "allow-scripts" });
});
it("adds only the tokens a published revision grants", () => {
  expect(hostedFrameAttributes(["downloads"])).toEqual({
    sandbox: "allow-scripts allow-downloads",
  });
  expect(hostedFrameAttributes(["allow-same-origin", "popups"])).toEqual({
    sandbox: "allow-scripts",
  });
});
