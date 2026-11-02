export const STATS_HOST = "stats.mycellios.com";
export const MARKETING_COMPARISONS = [
  ["grok-bot", "Grok Bot"], ["hermes-agent", "Hermes Agent"], ["muse", "Muse"],
  ["openclaw", "OpenClaw"], ["claude-cowork", "Claude Cowork"], ["chatgpt-dots", "ChatGPT dots"],
  ["manus", "Manus"], ["devin", "Devin"], ["paperclip", "Paperclip"],
  ["viktor", "Viktor"], ["instinct", "Instinct"], ["best-ai-agent-apps", "Best AI agent apps"],
] as const;

export const RETIRED_MARKETING_PAGES: Readonly<Record<string, string>> = {
  "/create": "/",
  "/spore/treasury": "/spore/rewards",
  "/spore/treasure": "/spore/rewards",
  "/spore/data": "/stats",
};

export function marketingPageRedirect(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  return Object.hasOwn(RETIRED_MARKETING_PAGES, path) ? RETIRED_MARKETING_PAGES[path]! : null;
}
