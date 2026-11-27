import { Trans } from "@lingui/react/macro";
import type { CacheCapabilities, ModelCredential } from "@mycellios/contracts";
import { ToggleGroup, ToggleGroupItem } from "@mycellios/ui-web";
import { useId } from "react";

/** How long the provider keeps a connection's processed prompt for the next turn. */
export type PromptCacheRetention = "short" | "long";

const RETENTION_MS: Record<PromptCacheRetention, number> = {
  short: 5 * 60 * 1000,
  long: 60 * 60 * 1000,
};

/**
 * Only Anthropic API-key connections send Anthropic's cache markers, where one hour is a
 * documented write option. Subscriptions, compatible servers and native engines keep the
 * provider default because the app cannot tell what their cache honours.
 */
export function promptCacheConfigurable(
  provider: string,
  credential: ModelCredential | undefined,
): boolean {
  return provider === "anthropic" && credential?.authKind === "api_key";
}

/** A connection that never chose keeps the five-minute default. */
export function savedPromptCacheRetention(
  credential: ModelCredential | undefined,
): PromptCacheRetention {
  return credential?.cacheCapabilities?.retentionMode === "long" ? "long" : "short";
}

/** The chosen window, keeping any other cache facts the connection already declares. */
export function promptCacheCapabilities(
  retention: PromptCacheRetention,
  saved: CacheCapabilities | undefined,
): CacheCapabilities {
  return {
    ...saved,
    scope: "connection",
    retentionMode: retention,
    retentionMs: RETENTION_MS[retention],
  };
}

export function PromptCacheField({
  value,
  onChange,
  disabled,
}: {
  value: PromptCacheRetention;
  onChange: (value: PromptCacheRetention) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const helpId = useId();
  return (
    <div className="mt-3" data-testid="prompt-cache">
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-sm text-foreground">
          <Trans>Prompt cache</Trans>
        </span>
        <ToggleGroup
          aria-labelledby={labelId}
          aria-describedby={helpId}
          value={[value]}
          disabled={disabled}
          onValueChange={([next]) => {
            if (next === "short" || next === "long") onChange(next);
          }}
          spacing={1}
          className="grid min-w-0 grid-cols-2 rounded-lg bg-muted p-1"
        >
          <ToggleGroupItem
            value="short"
            className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
          >
            <Trans>5 minutes</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="long"
            className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
          >
            <Trans>1 hour</Trans>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p id={helpId} className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">
        <Trans>1 hour makes replies after a pause faster, but saving the cache costs more.</Trans>
      </p>
    </div>
  );
}
