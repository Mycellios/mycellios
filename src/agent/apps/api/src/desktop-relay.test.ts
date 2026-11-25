import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import { desktopDeviceKey, desktopRelayKey, signDesktopRelay } from "../../../packages/adapters/src/desktop-relay.js";
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

it("marks a quitting PC offline at once while keeping its owner's choice to run on it", async () => {
  const app = new Hono();
  let preferred = false;
  close = mountDesktopRelay(app, {
    enabled: true,
    secret: "test-purpose-secret",
    desktopExecution: async (_actor, enabled) => {
      if (enabled !== undefined) preferred = enabled;
      return preferred;
    },
    authenticate: async (request) => request.headers.get("x-test-auth") === "yes" ? { actor: owner, sessionId: "session-a" } : null,
    ownsBot: async (_actor, id) => id === "test-bot",
  });
  const call = (action: string, body: unknown) => app.request(`/api/desktop-relay/${action}`, {
    method: "POST",
    headers: { "x-mycellios-desktop": "1", "x-test-auth": "yes", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const deviceId = randomUUID();
  const identity = await (await call("identity", {})).json();
  expect((await call("account", { deviceId, generation: randomUUID(), identity, agentExecution: 1 })).status).toBe(200);
  const probe = async () => {
    const body = JSON.stringify({ probe: "test-bot", agentExecution: 1, scope: { userId: owner.userId, spaceId: owner.spaceId }, nonce: randomUUID() });
    const time = String(Date.now());
    return (await app.request("/api/desktop-relay/internal", { method: "POST", headers: { "x-desktop-time": time, "x-desktop-signature": signDesktopRelay(desktopRelayKey("test-purpose-secret"), time, body) }, body })).json();
  };
  expect(await probe()).toEqual({ agentExecution: 1, available: true, preferred: true });
  expect((await call("release", { deviceId })).status).toBe(200);
  expect(await probe()).toEqual({ agentExecution: 1, available: false, preferred: true });
  expect(preferred).toBe(true);
});

it("reports actual disconnection distinctly from queue pressure without accepting work",async()=>{
 const app=fixture();const body=JSON.stringify({scope:{userId:owner.userId,spaceId:owner.spaceId},request:{method:"environment",botId:"test-bot"},nonce:randomUUID()}),time=String(Date.now());
 const r=await app.request("/api/desktop-relay/internal",{method:"POST",headers:{"x-desktop-time":time,"x-desktop-signature":signDesktopRelay(desktopRelayKey("test-purpose-secret"),time,body)},body});
 expect(r.status).toBe(409);expect(r.headers.get("x-mycellios-desktop-error")).toBe("desktop_disconnected");expect(await r.json()).toMatchObject({code:"desktop_disconnected"});
});

it("routes a Mico to the PC that reports its folder and reports an unchosen one as unresolved", async () => {
  const app = new Hono();
  close = mountDesktopRelay(app, {
    enabled: true,
    secret: "test-purpose-secret",
    desktopExecution: async () => true,
    authenticate: async (request) => request.headers.get("x-test-auth") === "yes"
      ? { actor: owner, sessionId: request.headers.get("x-test-session") ?? "session-a" }
      : null,
    ownsBot: async (_actor, id) => id === "test-bot" || id === "other-bot",
  });
  const call = (session: string, action: string, body: unknown) => app.request(`/api/desktop-relay/${action}`, {
    method: "POST",
    headers: { "x-mycellios-desktop": "1", "x-test-auth": "yes", "x-test-session": session, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const probe = async (botId: string, agentExecution = true) => {
    const body = JSON.stringify({ probe: botId, ...(agentExecution ? { agentExecution: 1 } : {}), scope: { userId: owner.userId, spaceId: owner.spaceId }, nonce: randomUUID() });
    const time = String(Date.now());
    return (await app.request("/api/desktop-relay/internal", { method: "POST", headers: { "x-desktop-time": time, "x-desktop-signature": signDesktopRelay(desktopRelayKey("test-purpose-secret"), time, body) }, body })).json();
  };
  const windows = { deviceId: randomUUID(), generation: randomUUID(), identity: await (await call("session-a", "identity", {})).json(), agentExecution: 1 };
  const mac = { deviceId: randomUUID(), generation: randomUUID(), identity: await (await call("session-b", "identity", {})).json(), agentExecution: 1 };
  // The account response tells a new Desktop that this server accepts its folder report.
  expect(await (await call("session-a", "account", windows)).json()).toMatchObject({ ownership: 1 });
  expect((await call("session-b", "account", mac)).status).toBe(200);
  expect(await probe("test-bot")).toEqual({ agentExecution: 1, available: false, preferred: true, unresolved: true });
  expect(await probe("test-bot", false)).toEqual({ available: false, unresolved: true });
  const folder = createHash("sha256").update("test-bot").digest("hex");
  expect((await call("session-b", "account", { ...mac, workspaces: [folder] })).status).toBe(200);
  expect(await probe("test-bot")).toEqual({ agentExecution: 1, available: true, preferred: true });
  expect(await probe("other-bot")).toEqual({ agentExecution: 1, available: false, preferred: true, unresolved: true });
  // Only folder keys are accepted, never names or paths.
  expect((await call("session-b", "account", { ...mac, workspaces: ["Writer"] })).status).toBe(409);
  expect((await call("session-b", "account", { ...mac, workspaces: Array.from({ length: 257 }, (_, n) => createHash("sha256").update(String(n)).digest("hex")) })).status).toBe(409);
});

it("says a Mico is working on another PC instead of asking to sign in again", async () => {
  const app = new Hono();
  close = mountDesktopRelay(app, {
    enabled: true,
    secret: "test-purpose-secret",
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
  const windows = { deviceId: randomUUID(), generation: randomUUID() };
  const mac = { deviceId: randomUUID(), generation: randomUUID() };
  expect((await call("session-a", "bind", { ...windows, botId: "test-bot" })).status).toBe(200);
  // Windows is running this Mico's work.
  const body = JSON.stringify({ request: { method: "environment", botId: "test-bot" }, scope: { userId: owner.userId, spaceId: owner.spaceId }, nonce: randomUUID() });
  const time = String(Date.now());
  const running = app.request("/api/desktop-relay/internal", { method: "POST", headers: { "x-desktop-time": time, "x-desktop-signature": signDesktopRelay(desktopRelayKey("test-purpose-secret"), time, body) }, body });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const refused = await call("session-b", "bind", { ...mac, botId: "test-bot" });
  expect(refused.status).toBe(409);
  const answer = await refused.json() as { error: string; code: string };
  expect(answer.code).toBe("busy_elsewhere");
  expect(answer.error).toContain("working on another computer");
  expect(answer.error).not.toContain("Sign in");
  close();
  await running.catch(() => undefined);
});

it("remembers the PC the owner chose for a Mico after the API forgets the binding", async () => {
  const chosen = new Map<string, string>();
  let failLookup = false;
  const mount = () => {
    const app = new Hono();
    close = mountDesktopRelay(app, {
      enabled: true,
      secret: "test-purpose-secret",
      desktopExecution: async () => true,
      authenticate: async (request) => request.headers.get("x-test-auth") === "yes"
        ? { actor: owner, sessionId: request.headers.get("x-test-session") ?? "session-a" }
        : null,
      ownsBot: async (_actor, id) => id === "test-bot" || id === "other-bot",
      chosenDevice: {
        get: async (scope, botId) => {
          if (failLookup) throw new Error("database unavailable");
          return chosen.get(JSON.stringify([scope.userId, scope.spaceId, botId]));
        },
        remember: async (scope, botId, deviceKey) => { chosen.set(JSON.stringify([scope.userId, scope.spaceId, botId]), deviceKey); },
      },
    });
    const call = (session: string, action: string, body: unknown) => app.request(`/api/desktop-relay/${action}`, {
      method: "POST",
      headers: { "x-mycellios-desktop": "1", "x-test-auth": "yes", "x-test-session": session, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const probe = async (botId: string) => {
      const body = JSON.stringify({ probe: botId, agentExecution: 1, scope: { userId: owner.userId, spaceId: owner.spaceId }, nonce: randomUUID() });
      const time = String(Date.now());
      return (await app.request("/api/desktop-relay/internal", { method: "POST", headers: { "x-desktop-time": time, "x-desktop-signature": signDesktopRelay(desktopRelayKey("test-purpose-secret"), time, body) }, body })).json();
    };
    return { call, probe };
  };
  let api = mount();
  const windows = { deviceId: randomUUID(), generation: randomUUID(), identity: await (await api.call("session-a", "identity", {})).json(), agentExecution: 1 };
  const mac = { deviceId: randomUUID(), generation: randomUUID(), identity: await (await api.call("session-b", "identity", {})).json(), agentExecution: 1 };
  const folder = createHash("sha256").update("test-bot").digest("hex");
  // Both PCs hold the Mico's folder, so its folder alone cannot settle which runs it.
  expect((await api.call("session-a", "account", { ...windows, workspaces: [folder] })).status).toBe(200);
  expect((await api.call("session-b", "account", { ...mac, workspaces: [folder] })).status).toBe(200);
  expect(await api.probe("test-bot")).toMatchObject({ available: false, unresolved: true });
  // Sending from Desktop on the Mac binds it there, and that choice is saved hashed.
  expect((await api.call("session-b", "bind", { deviceId: mac.deviceId, botId: "test-bot", generation: mac.generation })).status).toBe(200);
  expect([...chosen.values()]).toEqual([desktopDeviceKey(mac.deviceId)]);
  expect([...chosen.values()]).not.toContain(mac.deviceId);
  expect(await api.probe("test-bot")).toEqual({ agentExecution: 1, available: true, preferred: true });

  // A restarted API has no bindings: the saved choice routes the routine to the Mac.
  close();
  api = mount();
  expect((await api.call("session-a", "account", { ...windows, workspaces: [folder] })).status).toBe(200);
  expect((await api.call("session-b", "account", { ...mac, workspaces: [folder] })).status).toBe(200);
  expect(await api.probe("test-bot")).toEqual({ agentExecution: 1, available: true, preferred: true });
  const bound = async (session: string, deviceId: string) =>
    ((await (await api.call(session, "poll", { deviceId })).json()) as { bindings?: Array<{ botId: string }> }).bindings?.map(item => item.botId);
  expect(await bound("session-b", mac.deviceId)).toEqual(["test-bot"]);
  expect(await bound("session-a", windows.deviceId)).toEqual([]);
  // A Mico nobody chose stays unresolved, and an unavailable store never guesses a PC.
  expect(await api.probe("other-bot")).toMatchObject({ available: false, unresolved: true });
  failLookup = true;
  close();
  api = mount();
  expect((await api.call("session-a", "account", { ...windows, workspaces: [folder] })).status).toBe(200);
  expect((await api.call("session-b", "account", { ...mac, workspaces: [folder] })).status).toBe(200);
  expect(await api.probe("test-bot")).toMatchObject({ available: false, unresolved: true });
});

it("rechecks every Mico bound to a PC in one ownership read and drops the ones no longer owned", async () => {
  const app = new Hono();
  const owned = new Set(["test-bot", "other-bot", "third-bot"]);
  const batches: string[][] = [];
  let single = 0;
  close = mountDesktopRelay(app, {
    enabled: true,
    secret: "test-purpose-secret",
    desktopExecution: async () => true,
    authenticate: async (request) => request.headers.get("x-test-auth") === "yes" ? { actor: owner, sessionId: "session-a" } : null,
    ownsBot: async (_actor, id) => { single++; return owned.has(id); },
    ownedBots: async (_actor, ids) => { batches.push([...ids].sort()); return new Set(ids.filter(id => owned.has(id))); },
  });
  const call = (action: string, body: unknown) => app.request(`/api/desktop-relay/${action}`, {
    method: "POST",
    headers: { "x-mycellios-desktop": "1", "x-test-auth": "yes", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const probe = async (botId: string) => {
    const body = JSON.stringify({ probe: botId, agentExecution: 1, scope: { userId: owner.userId, spaceId: owner.spaceId }, nonce: randomUUID() });
    const time = String(Date.now());
    return (await app.request("/api/desktop-relay/internal", { method: "POST", headers: { "x-desktop-time": time, "x-desktop-signature": signDesktopRelay(desktopRelayKey("test-purpose-secret"), time, body) }, body })).json();
  };
  const pc = { deviceId: randomUUID(), generation: randomUUID(), identity: await (await call("identity", {})).json(), agentExecution: 1 };
  expect((await call("account", pc)).status).toBe(200);
  for (const botId of owned) expect(await probe(botId)).toMatchObject({ available: true });
  batches.length = 0;
  single = 0;
  owned.delete("other-bot");
  expect((await call("account", pc)).status).toBe(200);
  // One read for all three Micos, never one per Mico.
  expect(batches).toEqual([["other-bot", "test-bot", "third-bot"]]);
  expect(single).toBe(0);
  expect((await call("account", pc)).status).toBe(200);
  expect(batches.at(-1)).toEqual(["test-bot", "third-bot"]);
});

it("hands the relay to a new server version only on a signed request from inside the deployment", async () => {
  const app = new Hono();
  close = mountDesktopRelay(app, {
    enabled: true,
    secret: "test-purpose-secret",
    revision: "test-revision",
    authenticate: async () => ({ actor: owner, sessionId: "test-session" }),
    ownsBot: async (_actor, id) => id === "test-bot",
  });
  const signed = (path: string, payload: unknown, headers: Record<string, string> = {}) => {
    const body = JSON.stringify(payload);
    const time = String(Date.now());
    return app.request(path, {
      method: "POST",
      headers: { "x-desktop-time": time, "x-desktop-signature": signDesktopRelay(desktopRelayKey("test-purpose-secret"), time, body), ...headers },
      body,
    });
  };
  const handoff = (action: unknown, headers?: Record<string, string>) =>
    signed("/internal/desktop-relay/handoff", { action }, headers);
  expect((await app.request("/internal/desktop-relay/handoff", { method: "POST", body: JSON.stringify({ action: "start" }) })).status).toBe(401);
  expect((await handoff("start", { "x-forwarded-for": "203.0.113.7" })).status).toBe(404);
  expect((await handoff("drop")).status).toBe(400);
  const idle = await (await handoff("status")).json();
  expect(idle).toMatchObject({ revision: "test-revision", handingOff: false, openOperations: 0, connectedComputers: 0 });
  expect(idle.instance).toMatch(/^[0-9a-f-]{36}$/);
  expect(await (await handoff("start")).json()).toMatchObject({ instance: idle.instance, handingOff: true });
  // While it hands off, a check or new work waits for the new version instead of reading
  // the PC as offline; nothing is dispatched.
  const scope = { userId: owner.userId, spaceId: owner.spaceId };
  for (const payload of [
    { probe: "test-bot", scope, nonce: randomUUID() },
    { request: { method: "environment", botId: "test-bot" }, scope, nonce: randomUUID() },
  ]) {
    const refused = await signed("/api/desktop-relay/internal", payload);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("x-mycellios-desktop-error")).toBe("desktop_updating");
  }
  expect(await (await handoff("cancel")).json()).toMatchObject({ instance: idle.instance, handingOff: false });
  expect((await signed("/api/desktop-relay/internal", { probe: "test-bot", scope, nonce: randomUUID() })).status).toBe(200);
});
