import { describe, expect, it } from "vitest";
import {
  isFirstPartyAuthorization,
  isFirstPartyReturn,
  parseFirstPartyClients,
} from "./first-party";

const callback = "https://www.mycellios.com/agent/api/auth/callback/oidc";
const preview = "http://127.0.0.1:5188/api/auth/callback/oidc";
const clients = parseFirstPartyClients([
  { clientId: "fixture-public-agent", redirectUri: callback },
  { clientId: "fixture-local-agent", redirectUri: preview },
]);
const details = {
  authorization_id: "fixture-authorization-12345",
  client: { id: "fixture-public-agent", name: "Mycellios" },
  redirect_uri: callback,
  scope: "openid email profile",
};

describe("first-party account continuity", () => {
  it("continues only the registered identity-only client/callback pairs", () => {
    expect(isFirstPartyAuthorization(details, clients)).toBe(true);
    expect(
      isFirstPartyAuthorization(
        {
          ...details,
          client: { ...details.client, id: "fixture-local-agent" },
          redirect_uri: preview,
        },
        clients,
      ),
    ).toBe(true);
  });
  it.each(["unknown-client", "Mycellios", "fixture-local-agent"])(
    "does not trust a client name or mismatched registration: %s",
    (id) => {
      expect(
        isFirstPartyAuthorization({ ...details, client: { id, name: "Mycellios" } }, clients),
      ).toBe(false);
    },
  );
  it.each(["openid admin", "openid email network:write", "email profile", "openid offline_access"])(
    "requires a separate decision for other permissions: %s",
    (scope) => {
      expect(isFirstPartyAuthorization({ ...details, scope }, clients)).toBe(false);
    },
  );
  it.each([
    "https://evil.example/callback",
    callback + "/extra",
    callback + "?next=evil",
    "http://127.0.0.1:9999/api/auth/callback/oidc",
  ])("does not accept an unregistered callback: %s", (redirect_uri) => {
    expect(isFirstPartyAuthorization({ ...details, redirect_uri }, clients)).toBe(false);
  });
  it("validates completed returns without trusting arbitrary HTTPS destinations", () => {
    expect(isFirstPartyReturn(callback + "?code=fixture&state=fixture", clients)).toBe(true);
    expect(isFirstPartyReturn(preview + "?code=fixture&state=fixture", clients)).toBe(true);
    expect(
      isFirstPartyReturn("https://evil.example/agent/api/auth/callback/oidc?code=fixture", clients),
    ).toBe(false);
    expect(
      isFirstPartyReturn("https://user@www.mycellios.com/agent/api/auth/callback/oidc", clients),
    ).toBe(false);
  });
  it("fails closed for an invalid deployment manifest", () => {
    expect(() =>
      parseFirstPartyClients([
        { clientId: "fixture-public-agent", redirectUri: "https://evil.example/callback" },
      ]),
    ).toThrow();
    expect(isFirstPartyAuthorization(details, [])).toBe(false);
  });
});
