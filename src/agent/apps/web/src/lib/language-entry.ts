import { isUiLocale } from "./ui-locale";
import type { UiLocale } from "./ui-locale";
export const LANGUAGE_ENTRY_KEY = "mycellios.uiLocaleConfirmed";
function storage() { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }
export function hasConfirmedLanguage(store = storage()): boolean {
  try { return isUiLocale(store?.getItem(LANGUAGE_ENTRY_KEY)); } catch { return false; }
}
export function confirmLanguage(locale: UiLocale, store = storage()): void {
  try { store?.setItem(LANGUAGE_ENTRY_KEY, locale); } catch { /* Keep the choice for this visit. */ }
}
