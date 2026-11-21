import { describe, expect, it, vi } from "vitest";
import { CodexClientVersionResolver } from "./pi-codex-catalog.js";
import {
  CLAUDE_CODE_NPM_LATEST_ENDPOINT,
  PINNED_CLAUDE_CODE_VERSION,
  withClaudeCodeIdentity,
} from "./pi-claude-code-version.js";
import { reliableStreamOptions } from "./pi-runtime.js";

const OAUTH = "sk-ant-oat01-fixture";
const API_KEY = "sk-ant-api03-fixture";
const version = async () => "2.1.330";

describe("withClaudeCodeIdentity", () => {
  it("identifies Claude subscription requests as the current Claude Code release", async () => {
    const options = withClaudeCodeIdentity({}, OAUTH, version);
    await expect(options.transformHeaders!({ accept: "application/json" })).resolves.toEqual({
      accept: "application/json",
      "user-agent": "claude-cli/2.1.330",
    });
  });

  it("reads the token at request time, so a refreshed credential still counts", async () => {
    let token: string | undefined = API_KEY;
    const options = withClaudeCodeIdentity({}, () => token, version);
    await expect(options.transformHeaders!({})).resolves.toEqual({});
    token = OAUTH;
    await expect(options.transformHeaders!({})).resolves.toEqual({ "user-agent": "claude-cli/2.1.330" });
  });

  it("leaves API keys, explicit user agents and the caller's transform in charge", async () => {
    expect(await withClaudeCodeIdentity({ apiKey: API_KEY }, undefined, version).transformHeaders!({})).toEqual({});
    expect(await withClaudeCodeIdentity({}, OAUTH, version).transformHeaders!({ "User-Agent": "custom" }))
      .toEqual({ "User-Agent": "custom" });
    const caller = vi.fn((headers: Record<string, string | null>) => ({ ...headers, extra: "1" }));
    expect(await withClaudeCodeIdentity({ transformHeaders: caller }, OAUTH, version).transformHeaders!({}))
      .toEqual({ "user-agent": "claude-cli/2.1.330", extra: "1" });
  });

  it("falls back to the pinned floor when the version cannot be read", async () => {
    const options = withClaudeCodeIdentity({}, OAUTH, () => Promise.reject(new Error("offline")));
    await expect(options.transformHeaders!({})).resolves.toEqual({ "user-agent": `claude-cli/${PINNED_CLAUDE_CODE_VERSION}` });
  });
});

describe("Claude Code version resolution", () => {
  it("reads the Claude Code npm manifest and never goes below the floor", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(CLAUDE_CODE_NPM_LATEST_ENDPOINT);
      return new Response(JSON.stringify({ version: "2.1.200" }), { status: 200 });
    }) as unknown as typeof fetch;
    const resolver = new CodexClientVersionResolver({
      fetch: fetchImpl, endpoint: CLAUDE_CODE_NPM_LATEST_ENDPOINT, floor: PINNED_CLAUDE_CODE_VERSION,
    });
    await expect(resolver.resolve()).resolves.toBe(PINNED_CLAUDE_CODE_VERSION);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("reliableStreamOptions", () => {
  const model = { api: "anthropic-messages", provider: "anthropic", maxTokens: 8192, reasoning: false } as const;

  it("adds the Claude Code identity only for Anthropic models", async () => {
    const anthropic = reliableStreamOptions(model, {}, undefined, API_KEY);
    expect(anthropic.transformHeaders).toBeTypeOf("function");
    expect(await anthropic.transformHeaders!({})).toEqual({});
    const other = reliableStreamOptions({ ...model, api: "openai-completions", provider: "openrouter" }, {}, undefined, OAUTH);
    expect(other.transformHeaders).toBeUndefined();
  });
});
