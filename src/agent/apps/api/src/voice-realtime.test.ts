import type { Actor } from "@mycellios/contracts";
import { IsolationError } from "@mycellios/db";
import { ORPCError } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import type { VoiceDeps } from "./voice.js";
import {
  createRealtimeCall,
  REALTIME_CALL_TOOLS,
  realtimeCallInstructions,
} from "./voice-realtime.js";

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
const ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n";
const realtimeCalls = {
  model: "gpt-realtime",
  voice: "marin",
  transcriptionModel: "gpt-4o-mini-transcribe",
};

function deps(options: { enabled?: boolean; bot?: boolean; key?: boolean } = {}) {
  const prisma = {
    bot: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.bot === false ? null : { id: "bot-1", name: "Ada" }),
      findMany: vi.fn().mockResolvedValue([{ name: "Bruno" }]),
    },
    spaceSettingOverride: { findUnique: vi.fn().mockResolvedValue(null) },
    userVoicePreference: {
      findFirst: vi.fn().mockResolvedValue(
        options.key === false
          ? null
          : {
              isDefault: false,
              voiceId: null,
              credential: {
                id: "cred-1",
                userId: actor.userId,
                provider: "openai",
                secretId: "secret-1",
                createdAt: new Date(0),
                updatedAt: new Date(0),
              },
            },
      ),
    },
    userVoiceCredential: { findFirst: vi.fn().mockResolvedValue(null) },
    secret: { findFirst: vi.fn().mockResolvedValue({ id: "secret-1", ciphertext: "cipher" }) },
  };
  return {
    prisma,
    secrets: { load: vi.fn().mockReturnValue("sk-openai"), put: vi.fn() },
    env: options.enabled === false ? {} : { realtimeCalls },
  } as unknown as VoiceDeps & { prisma: typeof prisma };
}

describe("createRealtimeCall", () => {
  it("is unavailable until the operator turns it on", async () => {
    const fetchMock = vi.fn();
    await expect(
      createRealtimeCall(
        deps({ enabled: false }),
        actor,
        { botId: "bot-1", sdp: OFFER },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only calls the person's own Mico", async () => {
    const fetchMock = vi.fn();
    const d = deps({ bot: false });
    await expect(
      createRealtimeCall(d, actor, { botId: "bot-x", sdp: OFFER }, fetchMock),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(d.prisma.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bot-x", userId: "user-1", spaceId: "space-1", archivedAt: null },
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs the person's OpenAI voice key and never another payer", async () => {
    const fetchMock = vi.fn();
    await expect(
      createRealtimeCall(deps({ key: false }), actor, { botId: "bot-1", sdp: OFFER }, fetchMock),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses something that is not a call offer", async () => {
    await expect(
      createRealtimeCall(deps(), actor, { botId: "bot-1", sdp: "hello" }, vi.fn()),
    ).rejects.toBeInstanceOf(ORPCError);
  });

  it("sends the offer and a session with the call tools, keeping the key on the server", async () => {
    const fetchMock = vi.fn(async () => new Response(ANSWER, { status: 201 }));
    const answer = await createRealtimeCall(
      deps(),
      actor,
      { botId: "bot-1", sdp: OFFER, language: "es-ES" },
      fetchMock as unknown as typeof fetch,
    );

    expect(answer).toEqual({ sdp: ANSWER, model: "gpt-realtime" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-openai");
    const form = init.body as FormData;
    expect(form.get("sdp")).toBe(OFFER);
    const session = JSON.parse(String(form.get("session")));
    expect(session).toMatchObject({
      type: "realtime",
      model: "gpt-realtime",
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe",
            language: "es",
            prompt: "Ada, Bruno, Mycellios, Mico",
          },
          turn_detection: { type: "semantic_vad" },
        },
        output: { voice: "marin" },
      },
    });
    expect(session.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "ask_mico",
      "read_conversation",
      "answer_request",
      "end_call",
    ]);
    expect(session.instructions).toContain("Ada");
  });

  it.each([
    [401, "BAD_GATEWAY", /rejected that voice key/],
    [429, "TOO_MANY_REQUESTS", /quota/],
    [500, "BAD_GATEWAY", /could not start/],
  ])("explains a provider refusal (%s) without echoing its body", async (status, code, message) => {
    const fetchMock = vi.fn(async () => new Response("secret details sk-openai", { status }));
    const failure = createRealtimeCall(
      deps(),
      actor,
      { botId: "bot-1", sdp: OFFER },
      fetchMock as unknown as typeof fetch,
    );
    await expect(failure).rejects.toMatchObject({ code });
    await expect(failure).rejects.toThrow(message);
    await expect(failure).rejects.not.toThrow(/secret details/);
  });
});

describe("realtime call contract", () => {
  it("never offers a permanent approval to the voice", () => {
    const answer = REALTIME_CALL_TOOLS.find((tool) => tool.name === "answer_request");
    expect(answer?.parameters.properties.decision.enum).toEqual(["allow", "deny"]);
  });

  it("keeps the speech model as the voice, not the worker", () => {
    const text = realtimeCallInstructions({ micoName: "Ada" });
    expect(text).toContain("ask_mico");
    expect(text).toMatch(/Never invent results/);
    expect(text).toMatch(/only be given on screen/);
  });
});
