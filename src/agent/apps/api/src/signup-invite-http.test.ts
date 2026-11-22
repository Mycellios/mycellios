import { SIGNUP_INVITE_COOKIE } from "@mycellios/db";
import { describe, expect, it } from "vitest";
import { signupInviteHttp } from "./signup-invite-http.js";

const code = "beta-invite-code-0123456789abcdef";
const env = {
  signupInvite: { code, limit: 10 },
  authUrl: "https://www.example.test/agent/api/auth",
  webOrigin: "https://www.example.test/agent/",
};

describe("signup invitation link", () => {
  it("stores the code for signup and opens sign-in inside the deployment", async () => {
    const response = await signupInviteHttp(env).request(`/api/invite/${code}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://www.example.test/agent/sign-in");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SIGNUP_INVITE_COOKIE}=${code};`);
    expect(cookie).toContain("Path=/agent;");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a wrong code, or no configured invitation, like a missing page", async () => {
    for (const app of [signupInviteHttp(env), signupInviteHttp({ ...env, signupInvite: undefined })]) {
      const response = await app.request(`/api/invite/${code}x`);
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    const unconfigured = await signupInviteHttp({ ...env, signupInvite: undefined }).request(
      `/api/invite/${code}`,
    );
    expect(unconfigured.status).toBe(404);
  });
});
