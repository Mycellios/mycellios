import { describe, expect, it } from "vitest";
import { activateUiLocale } from "./i18n";
import { errorText, loadFailureKind } from "./user-error";

it("explains missing integration setup in the selected language", () => {
  activateUiLocale("de");
  try {
    expect(errorText(new Error("INTEGRATION_AUTH_SETUP_REQUIRED"))).toBe(
      "Diese Integration muss auf dem Server eingerichtet werden. Wende dich an die Administration.",
    );
  } finally {
    activateUiLocale("en");
  }
});

const withStatus = (status: number) =>
  Object.defineProperty(new Error("Something went wrong. Try again."), "status", { value: status });

describe("loadFailureKind", () => {
  it("names the cause when the error carries one", () => {
    expect(loadFailureKind(new TypeError("Network request failed"))).toBe("offline");
    expect(loadFailureKind(withStatus(503))).toBe("offline");
    expect(loadFailureKind(withStatus(401))).toBe("session");
    expect(loadFailureKind(withStatus(500))).toBe("server");
  });

  it("leaves other failures to their message", () => {
    expect(loadFailureKind(withStatus(400))).toBe("other");
    expect(loadFailureKind(new Error("Could not save the default space"))).toBe("other");
  });
});
