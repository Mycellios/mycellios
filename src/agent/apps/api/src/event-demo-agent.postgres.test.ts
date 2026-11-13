import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { runAsSystem, eventDemoSessionActive } from "@rakazo/db";
import { sealEventAgentTicket } from "../../../../core/event-demo-agent-ticket.js";
import { createApp } from "./app.js";

it.skipIf(process.env.VERIFY_DATABASE !== "1" || !process.env.DATABASE_URL)("opens real Agent profiles without replacing personal auth, duplicating grants or mixing guests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "event-agent-")), key = "bc".repeat(32);
  const file = join(directory, "bridge-key"); await writeFile(file, key);
  vi.stubEnv("MYCELLIOS_EVENT_DEMO_AGENT_SECRET_FILE", file);
  const origin = "http://127.0.0.1:5173", event = "test-only-event", now = Date.now();
  const app = await createApp({ databaseUrl: process.env.DATABASE_URL!, dataDir: directory,
    sandboxProvider: "fake", agentRuntime: "scripted", wakeupDriver: "memory", signupsEnabled: "true",
    authUrl: origin + "/api/auth", webOrigin: origin });
  const request = (path: string, body: unknown, headers: Record<string, string> = {}) => app.app.request(path, {
    method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const input = (guest = randomUUID()) => ({ event, guest, accountId: `demo:${event}:${guest}`, name: "Invitado de prueba",
    endsAt: now + 3600_000, issuedAt: Date.now(), origin, model: "mycellios/managed/antseed/deepseek-v4-flash" as const,
    apiKey: "myc_live_abcdefghij_" + "a".repeat(43) });
  try {
    const personal = await request("/api/auth/sign-up/email", { name: "Personal", email: `personal-${randomUUID()}@example.test`, password: "test-password-123" });
    expect(personal.status).toBeLessThan(400);
    const personalCookie = personal.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const ticket = input(), sealed = sealEventAgentTicket(key, ticket);
    const enter = await request("/api/demo/enter", { ticket: sealed });
    expect(enter.status, await enter.clone().text()).toBe(200);
    const first = await enter.json();
    const cookie = enter.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    expect(enter.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
    expect(cookie).not.toContain("better-auth");
    const headers = { cookie: personalCookie + "; " + cookie, "x-mycellios-demo-event": event, "x-rakazo-space-id": first.spaceId };
    const session = await app.app.request("/api/auth/get-session", { headers });
    expect(session.status).toBe(200);
    const guestSession = await session.json();
    expect(guestSession.user.id).toMatch(/^ed_/); expect(guestSession.user.emailVerified).toBe(false);
    expect(guestSession.session.token).toBe("");
    const me = await request("/rpc/me", { json: {} }, headers);
    expect(me.status, await me.clone().text()).toBe(200);
    expect((await me.json()).json).toMatchObject({ userId: guestSession.user.id, defaultModel: ticket.model, needsModel: false, isDeploymentOwner: false });
    const repeat = await request("/api/demo/enter", { ticket: sealed });
    expect(await repeat.json()).toEqual(first);
    const other = await request("/api/demo/enter", { ticket: sealEventAgentTicket(key, input()) });
    const second = await other.json(); expect(second.spaceId).not.toBe(first.spaceId); expect(second.botId).not.toBe(first.botId);
    const stolenSpace = await request("/rpc/me", { json: {} }, { ...headers, "x-rakazo-space-id": second.spaceId });
    expect(stolenSpace.status).not.toBe(200);
    const normal = await app.app.request("/api/auth/get-session", { headers: { cookie: personalCookie + "; " + cookie } });
    expect((await normal.json()).user.name).toBe("Personal");
    expect((await request("/api/auth/sign-up/email", {}, headers)).status).toBe(403);
    const absent = await app.app.request("/api/auth/get-session", { headers: { cookie: personalCookie, "x-mycellios-demo-event": event } });
    expect(await absent.json()).toBeNull();
    expect((await request("/api/demo/enter", { ticket: sealed }, { origin: "https://hostile.invalid" })).status).toBe(403);
    await runAsSystem("test temporary event persistence", async () => {
      expect(await app.prisma.bot.count({ where: { userId: guestSession.user.id } })).toBe(1);
      expect(await app.prisma.userModelCredential.count({ where: { userId: guestSession.user.id } })).toBe(1);
      expect(await eventDemoSessionActive(app.prisma, guestSession.user.id)).toBe(true);
      await app.prisma.session.update({ where: { id: guestSession.session.id }, data: { expiresAt: new Date(now - 1) } });
      expect(await eventDemoSessionActive(app.prisma, guestSession.user.id)).toBe(false);
    });
    expect(await (await app.app.request("/api/auth/get-session", { headers })).json()).toBeNull();
    expect((await request("/rpc/me", { json: {} }, headers)).status).not.toBe(200);
    expect((await app.app.request("/api/auth/get-session", { headers: { cookie: personalCookie } })).status).toBe(200);
  } finally { await app.stop(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
}, 90_000);
