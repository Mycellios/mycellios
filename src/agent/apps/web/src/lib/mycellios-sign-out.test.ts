import { describe, expect, it, vi } from "vitest";
import { signOutMycelliosHost } from "./mycellios-sign-out";

function fixture() {
  return {
    hostname: "www.mycellios.com",
    base: "/agent/",
    storage: {
      getItem: vi.fn(() => JSON.stringify({ accessToken: "owned-fixture-token" })),
      removeItem: vi.fn(),
    },
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          enabled: true,
          url: "https://identity.example.test",
          anonKey: "public-fixture-key",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 })),
  };
}
describe("shared first-party sign-out", () => {
  it("clears the native session and revokes it at the configured HTTPS identity provider", async () => {
    const options = fixture();
    await signOutMycelliosHost(options);
    expect(options.storage.removeItem).toHaveBeenCalledWith("mycellios.auth.session");
    expect(String(options.fetch.mock.calls[1]?.[0])).toBe(
      "https://identity.example.test/auth/v1/logout",
    );
    expect(options.fetch.mock.calls[1]?.[1]?.headers).toEqual({
      apikey: "public-fixture-key",
      authorization: "Bearer owned-fixture-token",
    });
  });
  it("keeps standalone and other-host sessions independent", async () => {
    for (const change of [{ base: "/" }, { hostname: "other.example.test" }]) {
      const options = { ...fixture(), ...change };
      await signOutMycelliosHost(options);
      expect(options.storage.removeItem).not.toHaveBeenCalled();
      expect(options.fetch).not.toHaveBeenCalled();
    }
  });
  it("finishes local sign-out when the provider is unavailable", async () => {
    const options = fixture();
    options.fetch.mockReset().mockRejectedValue(new Error("offline"));
    await signOutMycelliosHost(options);
    expect(options.storage.removeItem).toHaveBeenCalled();
  });
  it("does not block application logout when browser storage is unavailable", async () => {
    const options = fixture();
    Object.defineProperty(options, "storage", {
      get: () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(signOutMycelliosHost(options)).resolves.toBeUndefined();
    expect(options.fetch).not.toHaveBeenCalled();
  });
  it("never sends a token to a non-HTTPS provider", async () => {
    const options = fixture();
    options.fetch.mockReset().mockResolvedValue(
      Response.json({
        enabled: true,
        url: "http://identity.example.test",
        anonKey: "public-key",
      }),
    );
    await signOutMycelliosHost(options);
    expect(options.fetch).toHaveBeenCalledTimes(1);
  });
});
