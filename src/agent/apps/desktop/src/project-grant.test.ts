import { expect, it } from "vitest";
import { assertProjectGrant } from "./project-grant.js";
it("keeps a live cloud grant fixed so an earlier run cannot write into a replacement project", () => {
  expect(() => assertProjectGrant({ path: "C:\\first" }, "C:\\second")).toThrow("Revoke local computer access");
  expect(() => assertProjectGrant({ path: "C:\\first" }, "C:\\first")).not.toThrow();
  expect(() => assertProjectGrant(null, "C:\\second")).not.toThrow();
});
