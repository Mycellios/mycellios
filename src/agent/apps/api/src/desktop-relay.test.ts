import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import { desktopRelayKey, signDesktopRelay } from "../../../packages/adapters/src/desktop-relay.js";
import { HostComputerSandbox } from "../../../packages/adapters/src/host-computer-sandbox.js";
import { startHostComputerServer } from "../../../packages/adapters/src/host-computer-server.js";
import { DesktopRelayClient } from "../../desktop/src/desktop-relay.js";
import { mountDesktopRelay } from "./desktop-relay.js";
import { removeProjectFixture } from "./project-fixture-cleanup.js";

const owner = {
  userId: "test-user",
  spaceId: "test-space",
  email: "qa@mycellios.invalid",
  isDeploymentOwner: false,
};
let close = () => {};
afterEach(() => close());
function fixture(enabled = true) {
  const app = new Hono();
  close = mountDesktopRelay(app, {
    enabled,
    secret: "test-purpose-secret",
    authenticate: async (request) =>
      request.headers.get("x-test-auth") === "yes"
        ? { actor: owner, sessionId: "test-session" }
        : null,
    ownsBot: async (_actor, id) => id === "test-bot",

  });
  return app;
}
it("requires an authenticated native session and owned agent, and stays off by default", async () => {
  const app = fixture();
  const payload = { deviceId: randomUUID(), generation: randomUUID(), botId: "test-bot" };
  const call = (headers: Record<string, string>, input = payload) =>
    app.request("/api/desktop-relay/bind", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
  expect((await call({})).status).toBe(403);
  expect((await call({ "x-mycellios-desktop": "1" })).status).toBe(401);
  const headers = { "x-mycellios-desktop": "1", "x-test-auth": "yes" };
  expect((await call({ ...headers, origin: "https://evil.invalid" })).status).toBe(403);
  expect((await call(headers, { ...payload, botId: "another-user-bot" })).status).toBe(404);
  expect((await call(headers)).status).toBe(200);
  close();
  const disabled = fixture(false);
  expect((await disabled.request("/api/desktop-relay/identity", { method: "POST" })).status).toBe(
    404,
  );
});
it.each([false, true])(
  "executes real file and command work over the outbound native bridge (development copy=%s)",
  async (managedDevelopment) => {
    const app = fixture(true);
    const root = await mkdtemp(path.join(tmpdir(), "mc-relay-"));
    const token = "a".repeat(64);
    const server = await startHostComputerServer({
      root: path.join(root, "home"),
      token,
      hostname: "127.0.0.1",
    });
    const project = path.join(root, "project");
    await import("node:fs/promises").then((fs) => fs.mkdir(project));
    await writeFile(path.join(project, "example.txt"), "before");
    server.setEnabled(true);
    let valid = true;
    await server.selectProject(
      "test-bot",
      project,
      managedDevelopment
        ? {
            defaultFiles:true,
            validate: async () => {
              if (!valid)
                throw new Error("Link this agent's project on this computer before continuing.");
            },
          }
        : undefined,
    );
    const native = new DesktopRelayClient({
      base: "http://unit",
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-test-auth", "yes");
        return app.request(new URL(url).pathname, { ...init, headers });
      },
      localUrl: `http://127.0.0.1:${server.port}`,
      localToken: token,
      revoked: () => server.setEnabled(false),
    });
    const context = {
      operationId: "test",
      traceId: "test",
      userId: owner.userId,
      spaceId: owner.spaceId,
      botId: "test-bot",
      runId: "test-run",
      signal: new AbortController().signal,
    };
    const adapter = new HostComputerSandbox("", "", async (input) => {
      const body = JSON.stringify({
        request: input,
        scope: { userId: owner.userId, spaceId: owner.spaceId },
        nonce: randomUUID(),
      });
      const time = String(Date.now());
      return app.request("/api/desktop-relay/internal", {
        method: "POST",
        headers: {
          "x-desktop-time": time,
          "x-desktop-signature": signDesktopRelay(
            desktopRelayKey("test-purpose-secret"),
            time,
            body,
          ),
        },
        body,
      });
    });
    try {
        await native.bind("test-bot");
      const computer = await adapter.provision({ botId: "test-bot", homePath: "" }, context);
      await adapter.writeFile(
        computer,
        { path: "project/example.txt", content: new TextEncoder().encode("after") },
        context,
      );
      if (managedDevelopment) {
        await adapter.writeFile(
          computer,
          { path: "relative.txt", content: new TextEncoder().encode("relative-project-root") },
          context,
        );
        expect(await readFile(path.join(project, "relative.txt"), "utf8")).toBe(
          "relative-project-root",
        );
        await import("node:fs/promises").then((fs) => fs.mkdir(path.join(project, "nested")));
        const nested = [];
        for await (const event of adapter.execute(
          computer,
          {
            cwd: "nested",
            argv: [
              process.execPath,
              "-e",
              "const fs=require('node:fs');console.log(fs.readFileSync('../relative.txt','utf8'))",
            ],
          },
          context,
        ))
          nested.push(event);
        expect(JSON.stringify(nested)).toContain("relative-project-root");
      }
      expect(await readFile(path.join(project, "example.txt"), "utf8")).toBe("after");
      const events = [];
      for await (const event of adapter.execute(
        computer,
        {
          argv: [
            process.execPath,
            "-e",
            "const fs=require('node:fs');if(fs.readFileSync('example.txt','utf8')!=='after')process.exit(1);console.log('project-test-ok')",
          ],
        },
        context,
      ))
        events.push(event);
      expect(JSON.stringify(events)).toContain("project-test-ok");
      expect(JSON.stringify(events)).not.toContain(token);
      if (managedDevelopment) {
        const environment = await adapter.environment(computer, context);
        expect(environment.projectRoot).toBe(true);
        expect(environment.projectPath).toBe(project);
        valid = false;
        await expect(
          adapter.writeFile(
            computer,
            { path: "project/example.txt", content: new TextEncoder().encode("unauthorized") },
            context,
          ),
        ).rejects.toThrow("Link this agent");
        expect(await readFile(path.join(project, "example.txt"), "utf8")).toBe("after");
      }
    } finally {
      native.stop();
      await server.close();
      await removeProjectFixture(root, "mc-relay-");
    }
  },
  30_000,
);

