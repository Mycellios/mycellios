const LANGUAGES: Record<string, string> = {
  en: "English", es: "Spanish", de: "German", ko: "Korean", tr: "Turkish", hi: "Hindi",
  "pt-BR": "Brazilian Portuguese", "zh-CN": "Simplified Chinese", ru: "Russian", fr: "French",
  he: "Hebrew", nl: "Dutch", ja: "Japanese",
};
/** Only a supported locale may supply this presentation preference. */
export function responseLanguageInstruction(locale?: string | null): string | undefined {
  const language = locale && Object.hasOwn(LANGUAGES, locale) ? LANGUAGES[locale] : undefined;
  return language ? `The user selected ${language} (${locale}). Write your user-facing responses, greetings, questions and option labels in ${language}, unless the user explicitly requests another language. Preserve code, identifiers and quoted material as needed.` : undefined;
}
export function withResponseLanguage(prompt: string, locale?: string | null): string {
  const instruction = responseLanguageInstruction(locale);
  return instruction ? `${instruction}\n\n${prompt}` : prompt;
}
