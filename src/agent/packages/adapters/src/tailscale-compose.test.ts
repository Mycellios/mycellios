import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "../../..");
describe("Tailscale deployment boundaries", () => {
  for (const file of ["docker-compose.yml", "docker-compose.prod.yml", "docker-compose.images.yml"]) {
    it(`only adds the two server-owned gateway settings to ${file}`, () => {
      const name = `src/agent/infra/compose/${file}`;
      const current = parse(readFileSync(path.join(root, "infra/compose", file), "utf8"), { merge: true });
      const previous = parse(execFileSync("git", ["show", `HEAD:${name}`], { encoding: "utf8" }), { merge: true });
      for (const service of ["api", "worker"]) {
        const old = previous.services[service].environment;
        expect(current.services[service].environment).toEqual({ ...old, TAILSCALE_GATEWAY_URL: null, TAILSCALE_GATEWAY_KEY: null });
        expect(current.services[service].environment.MCP_ALLOW_PRIVATE_ENDPOINT).toBe(old.MCP_ALLOW_PRIVATE_ENDPOINT);
      }
    });
  }
  it("does not publish a proxy or grant host networking privileges", () => {
    const config = parse(readFileSync(path.join(root, "infra/tailscale/compose.yml"), "utf8"));
    const gateway = config.services["tailscale-gateway"];
    expect(gateway.ports).toBeUndefined();
    expect(gateway.privileged).toBeUndefined();
    expect(gateway.network_mode).toBeUndefined();
    expect(gateway.cap_drop).toEqual(["ALL"]);
    expect(gateway.volumes).toEqual(["tailnet-state:/state"]);
  });
});
