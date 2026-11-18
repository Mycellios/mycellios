import { Trans, useLingui } from "@lingui/react/macro";
import { MICO_AVATAR_DEFAULT_SHAPES, micoAvatarValue } from "@rakazo/contracts";
import { BotAvatar, Checkbox, Spinner } from "@rakazo/ui-web";
import { useId } from "react";
import { ProviderLogo } from "../../components/ProviderLogo";
import { PRIVACY_URL, TERMS_URL } from "../../lib/legal-links";
import { ChoiceList, ChoiceRow } from "./onboarding-ui";

/** The team over the title: a big Mico in the middle, smaller ones toward the edges. */
const TEAM_SIZES = [28, 30, 50, 64, 50, 24, 32] as const;
const TEAM = TEAM_SIZES.map((size, index) => {
  const shape = MICO_AVATAR_DEFAULT_SHAPES[index % MICO_AVATAR_DEFAULT_SHAPES.length]!;
  return { size, color: micoAvatarValue(shape.index, shape.originalColor), identity: `first-run-${shape.id}` };
});

const PLAN_LOGOS = [
  { name: "ChatGPT", providerId: "openai-codex" },
  { name: "Claude", providerId: "anthropic" },
] as const;

/**
 * The only question after sign-in on an empty account: start on free Mycellios models, or connect an
 * AI subscription the user already has. Both answers are rows of one grouped list, with the same weight.
 */
export function FirstRunChoice({
  disabled = false,
  loading = false,
  analytics,
  onAnalyticsChange,
  error = "",
  status = "",
  onStartFree,
  onUsePlan,
}: {
  disabled?: boolean;
  /** Free models were chosen and the team is being prepared. */
  loading?: boolean;
  /** Why the free start failed. Empty when nothing blocks it. */
  error?: string;
  /** What the free start is doing now, such as downloading OpenCode. */
  status?: string;
  analytics: boolean;
  onAnalyticsChange: (enabled: boolean) => void;
  onStartFree: () => void;
  onUsePlan: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col items-center text-center" data-testid="first-run-choice">
      <div className="flex h-20 items-center justify-center gap-3" aria-hidden="true">
        {TEAM.map((member) => (
          <BotAvatar key={member.identity} color={member.color} identity={member.identity} size={member.size} />
        ))}
      </div>
      <h1 id={`${id}-title`} className="mt-6 text-[38px] leading-[1.05] font-semibold tracking-tight text-foreground sm:text-[48px]">
        <Trans>Create your AI team.</Trans>
      </h1>
      <p className="mt-4 text-muted-foreground">
        <Trans>Choose the AI for your Micos.</Trans>
      </p>
      <ChoiceList className="mt-8 max-w-[440px]">
        <ChoiceRow
          title={<Trans>Use free models</Trans>}
          badge={<Trans>Recommended</Trans>}
          detail={<span id={`${id}-free`}><Trans>No AI subscription.</Trans></span>}
          disabled={disabled || loading}
          aria-busy={loading || undefined}
          aria-label={t`Use free models`}
          aria-describedby={error ? `${id}-free ${id}-error` : `${id}-free`}
          busy={loading ? <Spinner aria-label={t`Opening…`} className="text-muted-foreground" /> : undefined}
          onClick={onStartFree}
        />
        <ChoiceRow
          title={<Trans>Use my AI subscription</Trans>}
          detail={<span id={`${id}-plan`}><Trans>ChatGPT or Claude</Trans></span>}
          trailing={<PlanLogos />}
          disabled={disabled || loading}
          aria-label={t`Use my AI subscription`}
          aria-describedby={`${id}-plan`}
          onClick={onUsePlan}
        />
        <label className="flex cursor-pointer items-start gap-3 px-4 py-3.5 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={analytics}
            disabled={disabled}
            aria-describedby={`${id}-analytics`}
            onCheckedChange={(checked) => onAnalyticsChange(checked === true)}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold text-foreground">
              <Trans>Help improve Mycellios</Trans>
            </span>
            <span id={`${id}-analytics`} className="text-muted-foreground">
              <Trans>Share which screens you use. Never chats or files.</Trans>
            </span>
          </span>
        </label>
      </ChoiceList>
      {status && !error ? (
        <p role="status" className="mt-4 max-w-[440px] text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-4 max-w-[440px] text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p className="mt-6 max-w-[440px] text-sm leading-relaxed text-muted-foreground">
        <Trans>
          By continuing, you accept the{" "}
          <a href={TERMS_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
            Terms of Service
          </a>{" "}
          and confirm you have read the{" "}
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
            Privacy Policy
          </a>
          .
        </Trans>
      </p>
    </section>
  );
}

/** The subscription logos, shared with the connection step. */
export function PlanLogos() {
  return (
    <span className="flex items-center gap-2" aria-hidden="true">
      {PLAN_LOGOS.map((logo) => (
        <span key={logo.providerId} className="grid size-4 place-items-center [&_img]:size-4 [&_span]:size-4 [&_svg]:size-4">
          <ProviderLogo name={logo.name} providerId={logo.providerId} />
        </span>
      ))}
    </span>
  );
}
