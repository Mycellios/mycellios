import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { EventDemo, demoChatSchema } from "./event-demo.js";

/** Separate guest surface: no normal user/API-key principal is created or widened. */
export function mountEventDemo(app: FastifyInstance, service: EventDemo) {
  const base = "/mobile/v1/demo/" + service.config.id;
  const secure = service.config.publicOrigin.startsWith("https:");
  const cookie = secure ? "__Secure-mycellios-demo" : "mycellios-demo-local";
  const auth = (request: FastifyRequest) => {
    const parts = (request.headers.cookie ?? "").split(";").map(part => part.trim());
    const value = parts.find(part => part.startsWith(cookie + "="))?.slice(cookie.length + 1);
    return service.authenticate(value);
  };
  const failure = (reply: FastifyReply, error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const allowed = new Set(["demo_closed", "demo_full", "demo_session_required", "demo_view_required",
      "demo_enrollment_invalid", "demo_request_in_progress", "demo_request_too_large", "demo_browser_unavailable",
      "browser_ownership_proof_invalid", "browser_ownership_conflict", "insufficient_contribution_credits",
      "managed_operator_budget_exceeded", "managed_upstream_unavailable"]);
    const code = allowed.has(message) ? message : "demo_temporarily_unavailable";
    return reply.code(code.endsWith("required") ? 401 : code === "demo_full" || code === "demo_request_in_progress" ? 409
      : code === "demo_closed" ? 410 : code === "insufficient_contribution_credits" ? 402 : 503).send({ error: { code } });
  };
  const handle = (run: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("cache-control", "private, no-store").header("referrer-policy", "no-referrer");
      // Browser-only cookie writes and inference need the exact event origin.
      if (request.method !== "GET" && request.headers.origin !== service.config.publicOrigin)
        return reply.code(403).send({ error: { code: "demo_origin_required" } });
      try { return await run(request, reply); } catch (error) { return failure(reply, error); }
    };
  app.get(base, handle(async () => service.metadata()));
  app.post(base + "/enter", { bodyLimit: 2048 }, handle(async (request, reply) => {
    const input = z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/) }).strict().parse(request.body);
    const agent = request.headers["user-agent"] ?? "";
    const device = /iPad|Tablet/i.test(agent) ? "tablet" : /Android|iPhone|Mobile/i.test(agent) ? "mobile" : "computer";
    const result = await service.enter(input.nonce, device);
    const maxAge = Math.max(0, Math.floor((service.config.endsAt - Date.now()) / 1000));
    reply.header("set-cookie", `${cookie}=${result.token}; Path=${base}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
    return service.session(result.guest);
  }));
  app.get(base + "/session", handle(async request => service.session(await auth(request))));
  app.post(base + "/chat", { bodyLimit: 32_768 }, handle(async (request, reply) => {
    const guest = await auth(request);
    const input = demoChatSchema.parse(request.body);
    if (request.headers.accept === "text/event-stream") {
      if (!service.isOpen()) throw new Error("demo_closed");
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store, no-transform", "x-accel-buffering": "no" });
      const send = (value: unknown) => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write("data: " + JSON.stringify(value) + "\n\n");
      };
      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(": event-demo\n\n");
      }, 10_000); heartbeat.unref();
      try {
        const result = await service.chat(guest, input, chunk => send({ type: "delta", chunk }));
        send({ type: "result", result });
      } catch {
        // Existing holds remain recoverable; never suggest another paid request.
        send({ type: "error", code: "demo_request_unconfirmed" });
      } finally { clearInterval(heartbeat); reply.raw.end(); }
      return reply;
    }
    // Validate and obtain a held/settled result through the shared gateway. Paid
    // POSTs are never replayed automatically after an uncertain result.
    const result = await service.chat(guest, input);
    return reply.code(result.status === "completed" ? 200 : 202).send(result);
  }));
  app.get(base + "/chat/:key", handle(async request => {
    const { key } = z.object({ key: z.string().uuid() }).parse(request.params);
    return service.recover(await auth(request), key);
  }));
  app.post(base + "/contribute", { bodyLimit: 2048 }, handle(async request => {
    const guest = await auth(request);
    const proof = z.object({ workerId: z.string().uuid(), token: z.string().min(32).max(256) }).strict().parse(request.body);
    return service.link(guest, proof.workerId, proof.token);
  }));
  app.post(base + "/pause", { bodyLimit: 1024 }, handle(async request => service.unlink(await auth(request))));
  app.get(base + "/network-quote", handle(async request => {
    const result = service.networkQuote(await auth(request));
    return { maximumMicrounits: result.quote.creditsMicrounits, model: result.request.model, modelName: "GPT-2 · navegador" };
  }));
  app.post(base + "/network-test", { bodyLimit: 1024 }, handle(async request => {
    const body = z.object({ key: z.string().uuid(), maximumMicrounits: z.number().int().positive().max(1000) }).strict().parse(request.body);
    return service.networkTest(await auth(request), body.key, body.maximumMicrounits);
  }));
  app.get(base + "/network", handle(async request => {
    const header = request.headers.authorization;
    return service.network(header?.startsWith("DemoView ") ? header.slice(9) : undefined);
  }));
}
