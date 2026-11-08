import { resolveUiLocale } from "../lib/ui-locale";

const APPEARANCE_KEY = "rakazo.uiAppearance";

function readSystemLight(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
}

export function applyHostedChrome(
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
  systemLight = readSystemLight(),
): "light" | "dark" {
  const locale = resolveUiLocale({ storage });
  const theme = appearance(storage, systemLight);
  if (!root) return theme;
  root.lang = locale;
  root.dir = locale === "he" ? "rtl" : "ltr";
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  return theme;
}

function appearance(
  storage: Pick<Storage, "getItem"> | null,
  systemLight: boolean,
): "light" | "dark" {
  let preference = "light";
  try {
    const stored = storage?.getItem(APPEARANCE_KEY);
    if (stored === "system" || stored === "light" || stored === "dark") preference = stored;
  } catch {
    preference = "light";
  }
  if (preference === "system") return systemLight ? "light" : "dark";
  return preference === "dark" ? "dark" : "light";
}
