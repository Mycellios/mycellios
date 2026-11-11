import { describe, expect, it } from "vitest";
import { authErrorText, errorText, voiceAccountErrorText } from "./user-error";

it.each([
  ["NETWORK_VOICE_KEY_REJECTED", "Your Mycellios key was rejected. Reconnect it in Models."],
  ["NETWORK_VOICE_CREDITS", "You do not have enough Mycellios credits for this reply."],
  ["NETWORK_VOICE_BUSY", "Mycellios network voice is busy. Try again later or choose local voice."],
  ["NETWORK_VOICE_TIMEOUT", "Mycellios network voice took too long. Try again later or choose local voice."],
  ["NETWORK_VOICE_UNAVAILABLE", "Mycellios network voice is unavailable. Try again later or choose local voice."],
  ["NETWORK_VOICE_INVALID_AUDIO", "Mycellios returned invalid speech audio."],
  ["NETWORK_VOICE_NOT_CONNECTED", "Connect your Mycellios account in Models to use network voice."],
  ["NETWORK_VOICE_CONNECTION_UNAVAILABLE", "Your Mycellios connection could not be read. Open Models to check it."],
])("uses local copy for %s instead of an upstream message", (code, expected) => {
  expect(voiceAccountErrorText({ code, error: "provider details" })).toBe(expected);
});

describe("integration errorText", () => {
  it("explains server setup without a provider JSON dump", () => {
    expect(errorText(new Error("INTEGRATION_AUTH_SETUP_REQUIRED"))).toBe(
      "This integration needs server setup. Contact the administrator.",
    );
    expect(
      errorText(new Error('400 {"error":{"request_id":"private-request"}}'), "Could not connect"),
    ).toBe("Could not connect");
  });
});

describe("authErrorText", () => {
  it("maps PASSWORD_AUTH_DISABLED before the server message", () => {
    expect(
      authErrorText({ code: "PASSWORD_AUTH_DISABLED", message: "Server message" }, "Fallback"),
    ).toBe("Password sign-in is turned off on this server");
  });

  it("maps email code failures", () => {
    expect(authErrorText({ code: "INVALID_OTP", message: "Invalid OTP" }, "Fallback")).toBe(
      "Invalid code",
    );
    for (const code of ["OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]) {
      expect(authErrorText({ code, message: "Server message" }, "Fallback")).toBe(
        "Request a new code",
      );
    }
  });

  it("replaces Better Auth's raw too-long password message with the limit", () => {
    expect(
      authErrorText({ code: "PASSWORD_TOO_LONG", message: "Password too long" }, "Fallback"),
    ).toBe("Password must be 128 characters or fewer");
  });

  it("keeps messages from older servers", () => {
    expect(authErrorText({ message: "Registration is closed" }, "Fallback")).toBe(
      "Registration is closed",
    );
  });
});
