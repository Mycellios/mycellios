import { Circle, SlidersHorizontal } from "lucide-react";
import { appPath } from "../lib/app-path";

const PROVIDER_LOGOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/opencode/u, "opencode"],
  [/openai[-_ ]?codex|\bcodex\b|\bchatgpt\b|\bopenai\b/u, "openai"],
  [/\bclaude\b|\banthropic\b/u, "claude"],
  [/\bopenrouter\b/u, "openrouter"],
  [/\bdeepseek\b/u, "deepseek"],
  [/\bgoogle\b|\bgemini\b|\bantigravity\b/u, "gemini"],
  [/\bmistral\b/u, "mistral"],
  [/\bcursor\b/u, "cursor"],
  [/\bcline\b/u, "cline"],
  [/\bkimi\b|\bmoonshot\b/u, "kimi"],
  [/\bcopilot\b/u, "copilot"],
];

function providerLogo(name: string, providerId?: string): string {
  const label = name.toLowerCase();
  const id = (providerId ?? "").toLowerCase();
  if (label === "mycellios") return "mycellios";
  if (/openai[-_ ]?compatible|\bomniroute\b/u.test(label)) return "custom";
  const logo = PROVIDER_LOGOS.find(([pattern]) => pattern.test(`${label} ${id}`))?.[1];
  if (logo) return logo;
  if (/openai[-_ ]?compatible/u.test(id)) return "custom";
  return "unknown";
}

export function ProviderLogo({ name, providerId }: { name: string; providerId?: string }) {
  const logo = providerLogo(name, providerId);
  if (logo === "mycellios") {
    return <img src={appPath("/mycellios/app-icon-v2-192.png")} alt="" aria-hidden className="size-5 rounded-sm" />;
  }
  if (logo === "custom") return <SlidersHorizontal aria-hidden className="size-5 text-muted-foreground" />;
  if (logo === "openai") {
    return (
      <span className="relative size-5">
        <img src={appPath("/providers/openai-black.svg")} alt="" aria-hidden className="size-5 dark:hidden" />
        <img src={appPath("/providers/openai-white.svg")} alt="" aria-hidden className="absolute inset-0 hidden size-5 dark:block" />
      </span>
    );
  }
  if (logo === "unknown") return <Circle aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.75} />;
  return <img src={appPath(`/providers/${logo}.svg`)} alt="" aria-hidden className="size-5 object-contain brightness-0 dark:invert" />;
}
