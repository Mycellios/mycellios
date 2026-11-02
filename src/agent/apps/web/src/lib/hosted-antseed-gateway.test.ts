import { describe, expect, it } from "vitest";
import { hostedAntseedGateway } from "./hosted-antseed-gateway";

describe("hosted AntSeed connection preset", () => {
  it("presets only the owned local preview without configuring other local installs", () => {
    expect(hostedAntseedGateway("http://127.0.0.1:5188", "/")).toBe(
      "https://www.mycellios.com/agent/gateway/v1",
    );
    expect(hostedAntseedGateway("http://localhost:5188", "/")).toBe("");
    expect(hostedAntseedGateway("http://127.0.0.1:5189", "/")).toBe("");
  });
  it("uses the authenticated first-party gateway namespace", () => {
    expect(hostedAntseedGateway("https://www.mycellios.com", "/agent/")).toBe(
      "https://www.mycellios.com/agent/gateway/v1",
    );
    expect(hostedAntseedGateway("https://mycellios.com", "/agent/")).toBe(
      "https://mycellios.com/agent/gateway/v1",
    );
  });

  it("supports development preview ports without changing standalone defaults", () => {
    for (const origin of ["http://localhost:5191", "http://127.0.0.1:5194", "http://[::1]:5191"]) {
      expect(hostedAntseedGateway(origin, "/", true)).toBe("https://www.mycellios.com/agent/gateway/v1");
      expect(hostedAntseedGateway(origin, "/", false)).toBe("");
    }
    for (const origin of ["http://localhost.example:5191", "http://user@localhost:5191", "http://localhost:5191/other", "https://example.com"])
      expect(hostedAntseedGateway(origin, "/", true)).toBe("");
  });

  it("keeps standalone installations and untrusted origins unconfigured", () => {
    for (const origin of [
      "https://example.test",
      "http://www.mycellios.com",
      "https://www.mycellios.com.example.test",
      "https://user@www.mycellios.com",
      "https://www.mycellios.com:444",
      "https://www.mycellios.com/other",
      "https://www.mycellios.com?next=other",
      "null",
    ])
      expect(hostedAntseedGateway(origin, "/agent/")).toBe("");
    expect(hostedAntseedGateway("https://www.mycellios.com", "/")).toBe("");
  });
});
