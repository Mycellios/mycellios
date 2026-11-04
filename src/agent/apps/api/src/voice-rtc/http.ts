import type { Actor } from "@rakazo/contracts";
import type { Hono } from "hono";
import { readBoundedBody } from "../http-body.js";
import { type RtcMico, RtcVoiceSession, type RtcVoiceTarget } from "./session.js";

/** Deliberately unavailable on a shared/remote database, even if the flag is set. */
export function localVoiceTrialEnabled(flag: string | undefined, databaseUrl: string): boolean {
  if (flag !== "1") return false;
  try {
    const url = new URL(databaseUrl);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function mountRtcVoiceTrial(
  app: Hono,
  options: {
    authenticate(request: Request): Promise<Actor | null>;
    trustedOrigin(origin: string): boolean;
    makeMico: (actor: Actor, request: Request, target: RtcVoiceTarget) => RtcMico;
  },
) {
  const sessions = new Map<string, RtcVoiceSession>();
  const ownerKey = (actor: Actor) => JSON.stringify([actor.userId, actor.spaceId]);
  app.use("/api/voice/rtc/*", async (c, next) => {
    c.header("cache-control", "no-store");
    const origin = c.req.header("origin");
    if (origin && !options.trustedOrigin(origin)) return c.json({ error: "Origin refused." }, 403);
    if (
      c.req.method !== "GET" &&
      (!origin || !c.req.header("content-type")?.startsWith("application/json"))
    ) {
      return c.json({ error: "A same-origin JSON request is required." }, 403);
    }
    await next();
  });
  app.get("/api/voice/rtc/capability", async (c) => {
    if (!(await options.authenticate(c.req.raw))) return c.json({ error: "Unauthorized" }, 401);
    return c.json({
      enabled: true,
      experimental: true,
      maxDurationSeconds: 900,
      codec: "PCMU/8000",
    });
  });
  app.post("/api/voice/rtc/sessions", async (c) => {
    const actor = await options.authenticate(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    const owner = ownerKey(actor);
    const raw = await readBoundedBody(c.req.raw, 64 * 1024);
    if (raw === null) return c.json({ error: "Offer too large." }, 413);
    let body: { botId?: unknown; taskThreadId?: unknown; sdp?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: "Invalid offer." }, 400);
    }
    if (
      !body ||
      typeof body.botId !== "string" ||
      !body.botId.length ||
      body.botId.length > 200 ||
      (body.taskThreadId !== undefined &&
        (typeof body.taskThreadId !== "string" ||
          !body.taskThreadId.length ||
          body.taskThreadId.length > 200)) ||
      typeof body.sdp !== "string" ||
      !body.sdp.startsWith("v=0") ||
      !body.sdp.includes("m=audio ") ||
      body.sdp.includes("m=video ")
    ) {
      return c.json({ error: "An audio offer and Mico are required." }, 400);
    }
    // No await between the limit check and reservation, including body parsing.
    if (sessions.size >= 4 || [...sessions.values()].some((session) => session.owner === owner)) {
      return c.json({ error: "End the existing voice trial first." }, 409);
    }
    const target: RtcVoiceTarget = {
      botId: body.botId,
      ...(typeof body.taskThreadId === "string" ? { taskThreadId: body.taskThreadId } : {}),
    };
    const mico = options.makeMico(actor, c.req.raw, target);
    // Reserve before the first asynchronous operation, so parallel offers cannot exceed the owner limit.
    const session = new RtcVoiceSession(owner, target, mico, () => sessions.delete(session.id));
    sessions.set(session.id, session);
    let timer: NodeJS.Timeout | undefined;
    try {
      const sdp = await Promise.race([
        session.answer(body.sdp),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Negotiation timed out.")), 15_000);
        }),
      ]);
      return c.json({ id: session.id, type: "answer", sdp });
    } catch {
      await session.close();
      return c.json(
        { error: "No se pudo iniciar la voz. Comprueba el Mico y la configuración de voz local." },
        400,
      );
    } finally {
      clearTimeout(timer);
    }
  });
  app.post("/api/voice/rtc/sessions/:id/stop", async (c) => {
    const actor = await options.authenticate(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    const session = sessions.get(c.req.param("id"));
    if (session && session.owner !== ownerKey(actor)) return c.json({ error: "Not found." }, 404);
    await session?.close();
    return c.json({ ok: true });
  });
  return async () => {
    await Promise.all([...sessions.values()].map((session) => session.close()));
  };
}
