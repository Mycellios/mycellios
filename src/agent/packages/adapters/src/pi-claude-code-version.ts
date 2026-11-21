import type { ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { CodexClientVersionResolver } from "./pi-codex-catalog.js";

/**
 * Claude subscription (OAuth) requests identify as the Claude Code CLI. Anthropic
 * refuses newer models for CLI versions it considers too old, and the version
 * bundled in Pi only changes when we upgrade it. Like the Codex client version,
 * read the current release from npm, never answering below the pinned floor.
 */
export const CLAUDE_CODE_NPM_LATEST_ENDPOINT = "https://registry.npmjs.org/@anthropic-ai/claude-code/latest";
export const PINNED_CLAUDE_CODE_VERSION = "2.1.328";

const sharedClaudeCodeVersion = new CodexClientVersionResolver({
  endpoint: CLAUDE_CODE_NPM_LATEST_ENDPOINT,
  floor: PINNED_CLAUDE_CODE_VERSION,
});

/** Anthropic subscription access tokens; API keys never carry the CLI identity. */
export function isAnthropicOAuthToken(token: string | undefined): boolean {
  return Boolean(token?.includes("sk-ant-oat"));
}

/**
 * Wrap stream options so an Anthropic OAuth request carries the current Claude Code
 * user agent. The token is read at request time (a refresh may swap it after these
 * options are built). An explicit caller user agent wins, and a caller-supplied
 * transformHeaders keeps the final say.
 */
export function withClaudeCodeIdentity(
  options: ModelsSimpleStreamOptions,
  accessToken: string | (() => string | undefined) | undefined,
  version: () => Promise<string> = () => sharedClaudeCodeVersion.resolve(),
): ModelsSimpleStreamOptions {
  const callerTransform = options.transformHeaders;
  return {
    ...options,
    transformHeaders: async (headers) => {
      const token = (typeof accessToken === "function" ? accessToken() : accessToken) ?? options.apiKey;
      const explicit = Object.keys(headers).some((key) => key.toLowerCase() === "user-agent");
      const merged = isAnthropicOAuthToken(token) && !explicit
        ? { ...headers, "user-agent": `claude-cli/${await version().catch(() => PINNED_CLAUDE_CODE_VERSION)}` }
        : headers;
      return callerTransform ? callerTransform(merged) : merged;
    },
  };
}
