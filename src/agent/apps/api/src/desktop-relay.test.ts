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
function fixture(enabled = true, desktopExecution?: (actor: { userId: string; spaceId: string }, enabled?: boolean) => Promise<boolean>) {
  const app = new Hono();
  close = mountDesktopRelay(app, {
    enabled,
    secret: "test-purpose-secret",
    desktopExecution,
    authenticate: async (request) =>
      request.headers.get("x-test-auth") === "yes"
        ? { actor: owner, sessionId: "test-session" }
        : null,
    ownsBot: async (_actor, id) => id === "test-bot",

  });
  return app;
}
it("remembers Desktop execution across API restarts without admitting old clients or foreign bots", async () => {
  let preferred = false;
  let writes = 0;
  const preference = async (_actor: {userId:string;spaceId:string}, enabled?: boolean) => { if (enabled !== undefined) { writes++; preferred = enabled; } return preferred; };
  let app = fixture(true, preference);
  const headers = { "x-mycellios-desktop": "1", "x-test-auth": "yes", "content-type": "application/json" };
  const identity = await (await app.request("/api/desktop-relay/identity", { method:"POST", headers, body:"{}" })).json();
  const registration = { deviceId: randomUUID(), generation: randomUUID(), identity };
  expect((await app.request("/api/desktop-relay/account", { method:"POST", headers, body:JSON.stringify(registration) })).status).toBe(200);
  expect(preferred).toBe(false);
  expect((await app.request("/api/desktop-relay/account", { method:"POST", headers, body:JSON.stringify({...registration,agentExecution:1}) })).status).toBe(200);
  expect((await app.request("/api/desktop-relay/account", { method:"POST", headers, body:JSON.stringify({...registration,agentExecution:1}) })).status).toBe(200);
  expect(writes).toBe(1);
  const probe = async (botId = "test-bot") => {
    const body=JSON.stringify({probe:botId,agentExecution:1,scope:{userId:owner.userId,spaceId:owner.spaceId},nonce:randomUUID()});
    const timestamp=String(Date.now());
    return app.request("/api/desktop-relay/internal",{method:"POST",headers:{"x-desktop-time":timestamp,"x-desktop-signature":signDesktopRelay(desktopRelayKey("test-purpose-secret"),timestamp,body)},body});
  };
  expect(await (await probe()).json()).toEqual({agentExecution:1,available:true,preferred:true});
  expect((await probe("foreign-bot")).status).toBe(404);
  close();app=fixture(true,preference);
  expect(await (await probe()).json()).toEqual({agentExecution:1,available:false,preferred:true});
});

it("claims callbacks only after reauthentication and delivers each claim in that response", async () => {
  const app = new Hono();
  let onReauthenticate: (() => Promise<void>) | undefined;
  let pollAuthentications = 0;
  close = mountDesktopRelay(app, {
    enabled: true,
    secret: "test-purpose-secret",
    authenticate: async (request) => {
      if (new URL(request.url).pathname.endsWith("/poll") && ++pollAuthentications === 2)
        await onReauthenticate?.();
      return { actor: owner, sessionId: "test-session" };
    },
    ownsBot: async (_actor, id) => id === "test-bot",
  });
  const headers = { "x-mycellios-desktop": "1", "content-type": "application/json" };
  const native = (action: string, payload: unknown) =>
    app.request(`/api/desktop-relay/${action}`, { method: "POST", headers, body: JSON.stringify(payload) });
  const identity = await (await native("identity", {})).json();
  const deviceId = randomUUID();
  expect((await native("account", { deviceId, generation: randomUUID(), identity, agentExecution: 1 })).status).toBe(200);
  const sessionId = randomUUID();
  const dispatch = async (message: string) => {
    const body = JSON.stringify({
      nonce: randomUUID(),
      scope: { userId: owner.userId, spaceId: owner.spaceId },
      request: { method: "agentMessage", botId: "test-bot", runId: "test-run", sessionId, message },
    });
    const time = String(Date.now());
    return app.request("/api/desktop-relay/internal", {
      method: "POST",
      headers: {
        "x-desktop-time": time,
        "x-desktop-signature": signDesktopRelay(desktopRelayKey("test-purpose-secret"), time, body),
      },
      body,
    });
  };
  const first = await dispatch("first");
  let second: Response | undefined;
  onReauthenticate = async () => { second = await dispatch("during-reauthentication"); };
  try {
    const state = await (await native("poll", { deviceId, wait: true, active: [] })).json();
    expect(state.operations.map((op: { request: { message: string } }) => op.request.message))
      .toEqual(["first", "during-reauthentication"]);
    expect(state.active).toEqual(state.operations.map((op: { id: string }) => op.id));

    const next = await (await native("poll", { deviceId, active: state.active })).json();
    expect(next.operations).toEqual([]);
    expect(next.active).toEqual(state.active);
  } finally {
    await first.body?.cancel();
    await second?.body?.cancel();
  }
});
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
      fetch: async (url, init) => {
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


it("fences account registration to the exact native identity and rejects browser admission",async()=>{
 const app=fixture();const headers={"x-mycellios-desktop":"1","x-test-auth":"yes"};
 const call=(action:string,input:unknown,extra:Record<string,string>={})=>app.request("/api/desktop-relay/"+action,{method:"POST",headers:{...headers,...extra},body:JSON.stringify(input)});
 const identity=await(await call("identity",{})).json();
 const input={deviceId:randomUUID(),generation:randomUUID(),identity};
 expect((await call("account",input,{origin:"https://example.test"})).status).toBe(403);
 expect((await call("account",{...input,identity:{...identity,userId:"other"}})).status).toBe(403);
 expect((await call("account",{...input,identity:{...identity,connectionId:"stale"}})).status).toBe(403);
 expect((await call("account",input)).status).toBe(200);
 expect(await(await call("spaces",{})).json()).toEqual({spaces:[owner.spaceId]});
});

it("keeps a connected PC available while parallel calls wait, and reports queue pressure separately",async()=>{
 const app=fixture();const native={"x-mycellios-desktop":"1","x-test-auth":"yes"};const binding={deviceId:randomUUID(),generation:randomUUID(),botId:"test-bot"};
 expect((await app.request("/api/desktop-relay/bind",{method:"POST",headers:native,body:JSON.stringify(binding)})).status).toBe(200);
 const dispatch=(request:unknown)=>{const body=JSON.stringify({scope:{userId:owner.userId,spaceId:owner.spaceId},request,nonce:randomUUID()}),time=String(Date.now());return app.request("/api/desktop-relay/internal",{method:"POST",headers:{"x-desktop-time":time,"x-desktop-signature":signDesktopRelay(desktopRelayKey("test-purpose-secret"),time,body)},body});};
 const responses=await Promise.all(Array.from({length:8},()=>dispatch({method:"environment",botId:"test-bot"})));
 expect(responses.every(r=>r.status===200)).toBe(true);
 const excess=await dispatch({method:"environment",botId:"test-bot"});expect(excess.status).toBe(429);expect(excess.headers.get("x-mycellios-desktop-error")).toBe("desktop_busy");expect(await excess.json()).toMatchObject({code:"desktop_busy"});
 for(const response of responses)await response.body?.cancel();
 const missing=await dispatch({method:"environment",botId:"unowned"});expect(missing.status).toBe(404);
});

it("keeps the other signed-in desktop online when one instance disconnects", async () => {
  const app = new Hono();
  let preferred = false;
  close = mountDesktopRelay(app, {
    enabled: true,
    secret: "test-purpose-secret",
    desktopExecution: async (_actor, enabled) => {
      if (enabled !== undefined) preferred = enabled;
      return preferred;
    },
    authenticate: async (request) => request.headers.get("x-test-auth") === "yes"
      ? { actor: owner, sessionId: request.headers.get("x-test-session") ?? "session-a" }
      : null,
    ownsBot: async (_actor, id) => id === "test-bot",
  });
  const call = (session: string, action: string, body: unknown) => app.request(`/api/desktop-relay/${action}`, {
    method: "POST",
    headers: { "x-mycellios-desktop": "1", "x-test-auth": "yes", "x-test-session": session, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const prodIdentity = await (await call("session-a", "identity", {})).json();
  const devIdentity = await (await call("session-b", "identity", {})).json();
  const prodDevice = randomUUID();
  const devDevice = randomUUID();
  const prodGeneration = randomUUID();
  const devGeneration = randomUUID();
  const prod = { deviceId: prodDevice, generation: prodGeneration, identity: prodIdentity, agentExecution: 1 };
  const dev = { deviceId: devDevice, generation: devGeneration, identity: devIdentity, agentExecution: 1 };
  expect((await call("session-a", "account", prod)).status).toBe(200);
  expect((await call("session-a", "bind", { deviceId: prodDevice, generation: prodGeneration, botId: "test-bot" })).status).toBe(200);
  expect((await call("session-b", "account", dev)).status).toBe(200);
  expect((await call("session-a", "account", prod)).status).toBe(200);
  const probe = () => {
    const body = JSON.stringify({ probe: "test-bot", agentExecution: 1, scope: { userId: owner.userId, spaceId: owner.spaceId }, nonce: randomUUID() });
    const time = String(Date.now());
    return app.request("/api/desktop-relay/internal", { method: "POST", headers: { "x-desktop-time": time, "x-desktop-signature": signDesktopRelay(desktopRelayKey("test-purpose-secret"), time, body) }, body });
  };
  expect(await (await probe()).json()).toEqual({ agentExecution: 1, available: true, preferred: true });
  expect((await call("session-b", "revoke", { deviceId: devDevice })).status).toBe(200);
  expect(preferred).toBe(true);
  expect(await (await probe()).json()).toMatchObject({ available: true, preferred: true });
  expect((await call("session-a", "revoke", { deviceId: prodDevice })).status).toBe(200);
  expect(preferred).toBe(false);
});

it("reports actual disconnection distinctly from queue pressure without accepting work",async()=>{
 const app=fixture();const body=JSON.stringify({scope:{userId:owner.userId,spaceId:owner.spaceId},request:{method:"environment",botId:"test-bot"},nonce:randomUUID()}),time=String(Date.now());
 const r=await app.request("/api/desktop-relay/internal",{method:"POST",headers:{"x-desktop-time":time,"x-desktop-signature":signDesktopRelay(desktopRelayKey("test-purpose-secret"),time,body)},body});
 expect(r.status).toBe(409);expect(r.headers.get("x-mycellios-desktop-error")).toBe("desktop_disconnected");expect(await r.json()).toMatchObject({code:"desktop_disconnected"});
});
