import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { registerReleaseWorkStatus } from "../src/coordinator/release-work-status.js";
import { isTrustedLocalRequest } from "../src/coordinator/server.js";

it("exposes current work only to a local, non-forwarded request", async () => {
  const app = Fastify();
  const revision = "a".repeat(40);
  const snapshot = vi.fn().mockReturnValueOnce({ mesh: { jobs: 1 } }).mockReturnValue({ mesh: { jobs: 0 } });
  registerReleaseWorkStatus(app, revision, isTrustedLocalRequest, snapshot);
  try {
    const path = "/internal/release/work";
    expect((await app.inject({ url: path, remoteAddress: "192.0.2.4" })).statusCode).toBe(404);
    expect((await app.inject({ url: path, headers: { "x-forwarded-for": "127.0.0.1" } })).statusCode).toBe(404);
    expect(snapshot).not.toHaveBeenCalled();
    const first = await app.inject(path);
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json()).toEqual({ revision, mesh: { jobs: 1 } });
    expect((await app.inject(path)).json()).toEqual({ revision, mesh: { jobs: 0 } });
  } finally {
    await app.close();
  }
});
