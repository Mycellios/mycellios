import { expect, it } from "vitest";
import { signInDestination, signInNextFor } from "./sign-in-next";

it("carries only the Mycellios account deep links through sign-in", () => {
  expect(signInNextFor("/app", "?settings=api-keys")).toBe("api-keys");
  expect(signInNextFor("/app", "?settings=api-plan&apiCheckout=success")).toBe("api-plan");
  expect(signInNextFor("/app", "?settings=api-usage")).toBe("api-usage");
  expect(signInDestination("api-plan")).toBe("/app?settings=api-plan");
  expect(signInDestination("api-usage")).toBe("/app?settings=api-usage");
  expect(signInNextFor("/app", "?settings=profile")).toBe("profile");
  expect(signInDestination("profile")).toBe("/app?settings=profile");
  expect(signInNextFor("/app", "?settings=billing")).toBeNull();
  expect(signInNextFor("/onboarding", "?settings=api-keys")).toBeNull();
  expect(signInDestination("api-keys")).toBe("/app?settings=api-keys");
  expect(signInDestination("/integrations/setup")).toBe("/integrations/setup");
});

it("never follows an unknown or external destination", () => {
  for (const next of [null, "", "https://evil.example/", "//evil.example", "toString", "__proto__", "/app?settings=api-keys"])
    expect(signInDestination(next)).toBe("/app");
});
