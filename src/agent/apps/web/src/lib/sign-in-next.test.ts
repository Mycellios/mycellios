import { expect, it } from "vitest";
import { signInDestination, signInNextFor } from "./sign-in-next";

it("carries only the API keys deep link through sign-in", () => {
  expect(signInNextFor("/app", "?settings=api-keys")).toBe("api-keys");
  expect(signInNextFor("/app", "?settings=billing")).toBeNull();
  expect(signInNextFor("/onboarding", "?settings=api-keys")).toBeNull();
  expect(signInDestination("api-keys")).toBe("/app?settings=api-keys");
  expect(signInDestination("/integrations/setup")).toBe("/integrations/setup");
});

it("never follows an unknown or external destination", () => {
  for (const next of [null, "", "https://evil.example/", "//evil.example", "toString", "__proto__", "/app?settings=api-keys"])
    expect(signInDestination(next)).toBe("/app");
});
