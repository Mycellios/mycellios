/** Published standard, uncached text-token rates in USD per million tokens. */
export const PROVIDER_RATE_CHECKED_AT = "2026-11-01";
export const PROVIDER_RATE_PRESETS = [
  { id: "gpt-6.1-sol", provider: "openai", name: "GPT-6.1 Sol", input: 2, output: 10, terms: "Standard processing, short context" },
  { id: "gpt-6-luna", provider: "openai", name: "GPT-6 Luna", input: 0.1, output: 0.5, terms: "Standard processing, short context" },
  { id: "claude-sonnet-5-5", provider: "anthropic", name: "Claude Sonnet 5.5", input: 2, output: 10, terms: "Base text-token rates" },
  { id: "claude-opus-5-5", provider: "anthropic", name: "Claude Opus 5.5", input: 4, output: 20, terms: "Base text-token rates" },
] as const;
