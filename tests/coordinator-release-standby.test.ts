import { connect } from "node:net";
import { expect, it, vi } from "vitest";
import { createReleaseStandby } from "../src/coordinator/release-standby.js";

const revision = "a".repeat(40);
const standbyReady = "/internal/release/standby/ready";

it("reports the exact standby revision without admitting HTTP work", async () => {
  const check = vi.fn(async () => {});
  const app = createReleaseStandby(revision, check);
  try {
    const health = await app.inject(standbyReady);
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", revision, releaseState: "standby" });
    expect((await app.inject("/health")).statusCode).toBe(503);
    const chat = await app.inject({ method: "POST", url: "/v1/chat/completions" });
    expect(chat.statusCode).toBe(503);
    expect(chat.json()).toEqual({ error: { code: "release_standby" } });
    expect(check).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

it("fails closed on database errors and probes again on the next request", async () => {
  const check = vi.fn(async () => {});
  check.mockRejectedValueOnce(new Error("private connection details"));
  const app = createReleaseStandby(revision, check);
  try {
    const failed = await app.inject(standbyReady);
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: "unavailable", revision, releaseState: "standby" });
    expect((await app.inject(standbyReady)).statusCode).toBe(200);
    expect(() => createReleaseStandby("a".repeat(7), check)).toThrow("release_standby_revision_required");
  } finally {
    await app.close();
  }
});

it("shares an in-flight database probe across simultaneous requests", async () => {
  const started = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const check = vi.fn(() => {
    started.resolve();
    return finished.promise;
  });
  const app = createReleaseStandby(revision, check);
  try {
    const first = app.inject(standbyReady).then((response) => response.statusCode);
    await started.promise;
    const second = app.inject(standbyReady).then((response) => response.statusCode);
    await new Promise<void>((resolve) => setImmediate(resolve));
    finished.resolve();
    expect(await Promise.all([first, second])).toEqual([200, 200]);
    expect(check).toHaveBeenCalledTimes(1);
  } finally {
    finished.resolve();
    await app.close();
  }
});

it("rejects a worker WebSocket upgrade without reaching application admission", async () => {
  const check = vi.fn(async () => {});
  const app = createReleaseStandby(revision, check);
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("standby address missing");
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(address.port, "127.0.0.1", () => {
        socket.write("GET /internal/v1/workers/connect HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      });
      let response = "";
      socket.setTimeout(2_000, () => socket.destroy(new Error("upgrade request timed out")));
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => { response += chunk; });
      socket.once("end", () => { socket.end(); resolve(response); });
      socket.once("error", reject);
    });
    expect(response).toMatch(/^HTTP\/1\.1 503 /);
    expect(check).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
