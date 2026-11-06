import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_PLAN_LIMITS_URL,
  CODEX_PLAN_LIMITS_URL,
  parseClaudePlanLimits,
  parseCodexPlanLimits,
  readProviderPlanLimits,
} from "./provider-plan-limits.js";

describe("passive subscription quota", () => {
  it("keeps general and model-specific Codex windows distinct", () => {
    const result = parseCodexPlanLimits({
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1893456000 },
        secondary_window: { used_percent: 103, limit_window_seconds: 604800 },
      },
      code_review_rate_limit: { primary_window: { used_percent: 30 } },
      additional_rate_limits: [
        { limit_name: "Spark", rate_limit: { primary_window: { used_percent: 55 } } },
      ],
    });
    expect(result.plan).toBe("plus");
    expect(result.windows).toHaveLength(4);
    expect(result.windows[0]).toMatchObject({
      usedPercent: 12,
      durationMinutes: 300,
      model: null,
      resetsAt: "2030-01-01T00:00:00.000Z",
    });
    expect(result.windows[1]?.usedPercent).toBe(103);
    expect(result.windows[2]?.model).toBe("Code review");
    expect(result.windows[3]?.model).toBe("Spark");
  });
  it("treats Claude utilization as percent, rejects corrupt metrics, and preserves unknown resets", () => {
    expect(
      parseClaudePlanLimits({
        five_hour: { utilization: 0.7, resets_at: "bad" },
        seven_day: { utilization: "45" },
        seven_day_opus: { utilization: 90 },
      }).windows,
    ).toMatchObject([
      { usedPercent: 0.7, resetsAt: null, model: null },
      { usedPercent: 90, model: "Opus" },
    ]);
    expect(
      parseCodexPlanLimits({ rate_limit: { primary_window: { used_percent: -1 } } }).windows,
    ).toEqual([]);
  });
  it("uses only fixed read-only endpoints and the exact saved account", async () => {
    const transport = vi.fn(async () =>
      Response.json({ rate_limit: { primary_window: { used_percent: 10 } } }),
    ) as unknown as typeof fetch;
    await readProviderPlanLimits({
      provider: "openai-codex",
      accountId: "owned-id",
      accessToken: "secret",
      fetch: transport,
    });
    expect(transport).toHaveBeenCalledWith(
      CODEX_PLAN_LIMITS_URL,
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({
          "chatgpt-account-id": "owned-id",
          authorization: "Bearer secret",
        }),
      }),
    );
    await readProviderPlanLimits({
      provider: "anthropic",
      accessToken: "other-secret",
      fetch: transport,
    });
    expect(transport).toHaveBeenLastCalledWith(
      CLAUDE_PLAN_LIMITS_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ "anthropic-beta": "oauth-2025-04-20" }),
      }),
    );
  });
  it("never probes unsupported providers or Codex without an account identity", async () => {
    const transport = vi.fn();
    expect(
      (
        await readProviderPlanLimits({
          provider: "custom",
          accessToken: "secret",
          fetch: transport,
        })
      ).status,
    ).toBe("unsupported");
    expect(
      (
        await readProviderPlanLimits({
          provider: "openai-codex",
          accessToken: "secret",
          fetch: transport,
        })
      ).reason,
    ).toBe("permission");
    expect(transport).not.toHaveBeenCalled();
  });
  it("isolates authentication, permission, rate limits and invalid responses without leaking bodies", async () => {
    for (const [status, expected] of [
      [401, "reconnect"],
      [403, "unavailable"],
      [429, "rate_limited"],
      [500, "unavailable"],
    ] as const) {
      const value = await readProviderPlanLimits({
        provider: "anthropic",
        accessToken: "private",
        now: 0,
        fetch: vi.fn(
          async () => new Response("sensitive", { status, headers: { "retry-after": "120" } }),
        ),
      });
      expect(value.status).toBe(expected);
      expect(JSON.stringify(value)).not.toContain("sensitive");
      if (status === 429) expect(value.retryAt).toBe("1970-01-01T00:02:00.000Z");
    }
    const invalid = await readProviderPlanLimits({
      provider: "anthropic",
      accessToken: "private",
      fetch: vi.fn(async () => new Response("{")),
    });
    expect(invalid.reason).toBe("invalid_response");
    const oversized = await readProviderPlanLimits({
      provider: "anthropic",
      accessToken: "private",
      fetch: vi.fn(async () => new Response("{}", { headers: { "content-length": "200000" } })),
    });
    expect(oversized.reason).toBe("invalid_response");
  });
  it("times out even a transport that ignores abort; never invents an empty allowance", async () => {
    const value = await readProviderPlanLimits({
      provider: "anthropic",
      accessToken: "private",
      timeoutMs: 5,
      fetch: vi.fn(() => new Promise<Response>(() => {})),
    });
    expect(value).toMatchObject({ status: "unavailable", reason: "timeout", windows: [] });
    expect(
      (
        await readProviderPlanLimits({
          provider: "anthropic",
          accessToken: "private",
          fetch: vi.fn(async () => Response.json({})),
        })
      ).status,
    ).toBe("unsupported");
  });
});
