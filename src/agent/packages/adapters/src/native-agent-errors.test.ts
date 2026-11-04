import { describe, expect, it } from "vitest";
import { nativeAgentProtocolError } from "./native-agent-errors.js";

describe("native provider refusals", () => {
  it.each([
    [{ code: -32000, data: { details: "Rate limit reached" } }, "rate limiting"],
    [{ data: { error: { code: "subscription:free-usage-exhausted" } } }, "usage limit"],
    [{ status: 401 }, "sign in again"],
    [{ message: JSON.stringify({ error: { code: "model_not_found" } }) }, "model is unavailable"],
    [{ data: { detail: "Permission denied" } }, "refused access"],
    [{ errors: ["maximum context length exceeded"] }, "context limit"],
  ])("retains the actionable refusal category without echoing diagnostics", (input, message) => {
    expect(nativeAgentProtocolError(input).message).toContain(message);
  });

  it("never exposes raw errors or credentials, even for unknown refusals", () => {
    const value = { message: "private-user-path private-secret-token", data: { detail: "private-prompt" } };
    expect(nativeAgentProtocolError(value).message).toBe("Native agent rejected the protocol request");
    expect(nativeAgentProtocolError({ message: "rate limit private-secret-token" }).message).not.toContain("private-secret-token");
    expect(nativeAgentProtocolError(null).message).toBe("Native agent rejected the protocol request");
  });
});
