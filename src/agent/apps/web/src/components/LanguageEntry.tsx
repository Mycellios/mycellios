import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Field, FieldLabel, OptionSelect } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { getActiveUiLocale, setUiLocale } from "../lib/i18n";
import { confirmLanguage, hasConfirmedLanguage } from "../lib/language-entry";
import { UI_LOCALES, UI_LOCALE_LABELS } from "../lib/ui-locale";
import type { UiLocale } from "../lib/ui-locale";
import { AuthMushroom } from "./AuthMushroom";

export function LanguageEntry({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const id = useId();
  const [confirmed, setConfirmed] = useState(hasConfirmedLanguage);
  const [locale, setLocale] = useState<UiLocale>(getActiveUiLocale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function choose() {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      const activated = await setUiLocale(locale);
      if (activated !== locale) { setError(true); return; }
      confirmLanguage(activated); setConfirmed(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  if (confirmed) return children;
  return <main className="grid min-h-dvh place-items-center bg-background px-6 py-10" data-testid="language-entry">
    <form className="w-full max-w-sm space-y-6" onSubmit={event => { event.preventDefault(); void choose(); }}>
      <div className="flex justify-center"><AuthMushroom /></div>
      <h1 className="text-center text-2xl font-medium"><Trans>Choose your language</Trans></h1>
      <Field>
        <FieldLabel htmlFor={id}><Trans>Language</Trans></FieldLabel>
        <OptionSelect id={id} value={locale} disabled={busy} className="w-full"
          onValueChange={setLocale}
          options={UI_LOCALES.map(value => ({value, label: UI_LOCALE_LABELS[value]}))} />
      </Field>
      {error ? <p role="alert" className="text-sm text-destructive">{t`Could not load this language. Try again.`}</p> : null}
      <Button type="submit" disabled={busy} className="w-full"><Trans>Continue</Trans></Button>
    </form>
  </main>;
}
