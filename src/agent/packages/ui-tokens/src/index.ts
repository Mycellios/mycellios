export const APPEARANCE_PREFERENCES = ["system", "light", "dark"] as const;

export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];

export type ResolvedAppearance = "light" | "dark";

export const UI_APPEARANCE_STORAGE_KEY = "rakazo.uiAppearance";

/**
 * Semantic palette shared by web, Electron, and Expo. Names follow the shadcn
 * convention so the same slot means the same thing on every surface: a `border`
 * is always a border and never a fill.
 */
export type ColorTokens = {
  skillForeground: string;
  skillDocument: string;
  skillData: string;
  skillDesign: string;
  skillCode: string;
  workspaceTaskBlue: string;
  workspaceAccentForeground: string;
  workspaceAccent: string;
  workspacePrimaryForeground: string;
  workspacePrimary: string;
  workspaceMutedForeground: string;
  workspaceSidebarBorder: string;
  workspaceSidebarAccent: string;
  workspaceSidebar: string;
  workspaceBorder: string;
  workspaceCard: string;
  workspaceForeground: string;
  workspaceBackground: string;
  background: string;
  /** Modals: a step lighter than the page so they read as raised above it. */
  dialog: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  /** Fill and hairline where native Liquid Glass is unavailable (Android, iOS before 26). */
  glassFill: string;
  glassStroke: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  chatUser: string;
  /** White in both themes: the user bubble is a solid fill (light grey in dark, near-black in light). */
  chatUserForeground: string;
  muted: string;
  mutedForeground: string;
  /** Tertiary text: placeholders, list markers, quote bars, timestamps. */
  faintForeground: string;
  accent: string;
  accentForeground: string;
  /** Destructive text and outlines. */
  destructive: string;
  /** Solid destructive fill (Hang up, a filled Delete); its text is `destructiveForeground`. */
  destructiveFill: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  link: string;
  /** Backing behind a link's site icon. White in both themes so dark logos stay visible on any bubble. */
  faviconPlate: string;
  success: string;
  warning: string;
  statusWorking: string;
  /** Unread dot. The one blue in the inbox, in both themes. */
  unread: string;
  /** Working dot on a busy bot's avatar. The one green, in both themes. */
  workingDot: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
};

export const darkTokens = {
  workspaceBackground: "#202023",
  workspaceForeground: "#eeeeef",
  workspaceCard: "#2a2a2e",
  workspaceBorder: "#38383d",
  workspaceSidebar: "#18181b",
  workspaceSidebarAccent: "#303035",
  workspaceSidebarBorder: "#38383d",
  workspaceMutedForeground: "#a7a7af",
  workspacePrimary: "#f0f0f2",
  workspacePrimaryForeground: "#18181b",
  workspaceAccent: "#343439",
  workspaceAccentForeground: "#eeeef0",
  workspaceTaskBlue: "#6ba9ff",
  skillCode: "#2465a7",
  skillDesign: "#b93e80",
  skillData: "#208576",
  skillDocument: "#7556d5",
  skillForeground: "#ffffff",

  background: "#142019",
  dialog: "#1E2A22",
  foreground: "#EEE9E2",
  card: "#1E2A22",
  cardForeground: "#EEE9E2",
  popover: "#1E2A22",
  popoverForeground: "#EEE9E2",
  glassFill: "#2C2C2E",
  glassStroke: "#FCFCFC26",
  primary: "#EEE9E2",
  primaryForeground: "#142019",
  secondary: "#7676803D",
  secondaryForeground: "#FFFFFF",
  chatUser: "#344438",
  chatUserForeground: "#EEE9E2",
  muted: "#1E2A22",
  mutedForeground: "#A8B3A3",
  faintForeground: "#93A18E",
  accent: "#344438",
  accentForeground: "#EEE9E2",
  destructive: "#FF9592",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#EEE9E226",
  input: "#93A18E66",
  ring: "#AD7A48",
  sidebar: "#101A14",
  sidebarForeground: "#EEE9E2",
  sidebarBorder: "#EEE9E226",
  sidebarAccent: "#26362B",
  sidebarAccentForeground: "#EEE9E2",
  link: "#D4AD80",
  faviconPlate: "#FFFFFF",
  success: "#3FA266",
  warning: "#DB941E",
  statusWorking: "#459FFE",
  unread: "#005BC7",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.28)",
  scrollbar: "#1E2026",
  scrollbarHover: "#2E313A",
} as const satisfies ColorTokens;

export const lightTokens = {
  workspaceBackground: "#f5f5f7",
  workspaceForeground: "#19191b",
  workspaceCard: "#fff",
  workspaceBorder: "#e7e7eb",
  workspaceSidebar: "#e8e8ed",
  workspaceSidebarAccent: "#dadade",
  workspaceSidebarBorder: "#e1e1e5",
  workspaceMutedForeground: "#737378",
  workspacePrimary: "#18181b",
  workspacePrimaryForeground: "#fff",
  workspaceAccent: "#e9e9ed",
  workspaceAccentForeground: "#19191b",
  workspaceTaskBlue: "#006ad4",
  skillCode: "#2465a7",
  skillDesign: "#b93e80",
  skillData: "#208576",
  skillDocument: "#7556d5",
  skillForeground: "#ffffff",

  background: "#F8F5F0",
  dialog: "#F8F5F0",
  foreground: "#1E2A22",
  card: "#EDE8E1",
  cardForeground: "#1E2A22",
  popover: "#F8F5F0",
  popoverForeground: "#1E2A22",
  glassFill: "#FFFFFF",
  glassStroke: "#14141416",
  primary: "#1E2A22",
  primaryForeground: "#F8F5F0",
  secondary: "#7676801F",
  secondaryForeground: "#000000",
  chatUser: "#1E2A22",
  chatUserForeground: "#F8F5F0",
  muted: "#EEE9E2",
  mutedForeground: "#596653",
  faintForeground: "#70806D",
  accent: "#E4E9DF",
  accentForeground: "#1E2A22",
  destructive: "#C12429",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#1E2A2229",
  input: "#70806D80",
  ring: "#AD7A48",
  sidebar: "#EEE9E2",
  sidebarForeground: "#1E2A22",
  sidebarBorder: "#1E2A2229",
  sidebarAccent: "#F8F5F0",
  sidebarAccentForeground: "#1E2A22",
  link: "#80552E",
  faviconPlate: "#FFFFFF",
  success: "#007041",
  warning: "#885A07",
  statusWorking: "#0C64C1",
  unread: "#005BC7",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.19)",
  scrollbar: "#C8C8C4",
  scrollbarHover: "#A8A8A4",
} as const satisfies ColorTokens;

/** Web and Electron only: the primary fill's hover and disabled states. Mobile has no hover. */
export type WebColorTokens = ColorTokens & {
  primaryHover: string;
  primaryDisabled: string;
};

/**
 * Web and Electron inherit the shared Mycellios forest/paper palette.
 * Only pointer interaction states differ from native surfaces.
 */
export const webDarkOverrides = {
  primaryHover: "#D8D2C9",
  primaryDisabled: "#EEE9E221",
  destructiveFill: "#CF2B35",
} as const satisfies Partial<WebColorTokens>;

export const webLightOverrides = {
  primaryHover: "#344438",
  primaryDisabled: "#1E2A2226",
} as const satisfies Partial<WebColorTokens>;

export const webDarkTokens: WebColorTokens = { ...darkTokens, ...webDarkOverrides };
export const webLightTokens: WebColorTokens = { ...lightTokens, ...webLightOverrides };

/** Dark palette. Prefer `tokensForAppearance` when theme-aware. */
export const tokens = darkTokens;

export const RADIUS = "0.75rem";

export const fontWeight = { regular: "400", medium: "500", semibold: "600" } as const;

/**
 * Native text styles on the system font, in points: iOS body text is 17/22. Titles use the
 * font's own line spacing, written out so they don't inherit a smaller body line height.
 */
export const typeScale = {
  title: { fontSize: 22, lineHeight: 26, fontWeight: fontWeight.semibold },
  headline: { fontSize: 19, lineHeight: 23, fontWeight: fontWeight.semibold },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: fontWeight.medium },
  body: { fontSize: 17, lineHeight: 22 },
  secondary: { fontSize: 15, lineHeight: 19 },
  caption: { fontSize: 14, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 16 },
} as const;

/**
 * Text grows with the iOS text size until body text reaches 23pt, the xxxLarge size. Larger
 * accessibility sizes keep that size, so message bubbles, rows and cards keep their layout.
 */
export const MAX_FONT_SCALE = 23 / typeScale.body.fontSize;

export const usageSeriesColors = ["#a855f7", "#3b82f6", "#0d9488", "#c77700", "#ec4899", "#6366f1"] as const;

export const botColors = [
  "#3EC5A8",
  "#F5A03C",
  "#6A6BF5",
  "#9B5CF6",
  "#3B82F6",
  "#F2622A",
  "#D9508A",
] as const;

export function isAppearancePreference(
  value: string | null | undefined,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeAppearancePreference(
  raw: string | null | undefined,
): AppearancePreference {
  return isAppearancePreference(raw) ? raw : "light";
}

export type ResolveAppearancePreferenceOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function resolveAppearancePreference(
  options: ResolveAppearancePreferenceOptions = {},
): AppearancePreference {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStoredAppearance(options.storage ?? getLocalStorage());
  return normalizeAppearancePreference(stored);
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Ignore quota / private-mode failures; in-memory preference still applies.
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  system: ResolvedAppearance = "dark",
): ResolvedAppearance {
  if (preference === "system") return system;
  return preference;
}

export function tokensForAppearance(appearance: ResolvedAppearance): ColorTokens {
  return appearance === "light" ? lightTokens : darkTokens;
}

/** The web and Electron palette; `tokensForAppearance` is the mobile one. */
export function webTokensForAppearance(appearance: ResolvedAppearance): WebColorTokens {
  return appearance === "light" ? webLightTokens : webDarkTokens;
}

function readStoredAppearance(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `cardForeground` -> `--card-foreground` */
export function cssVariableName(token: keyof WebColorTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderBlock(selector: string, colorScheme: ResolvedAppearance, palette: WebColorTokens) {
  const lines = (Object.keys(palette) as (keyof WebColorTokens)[]).map(
    (token) => `  ${cssVariableName(token)}: ${palette[token].toLowerCase()};`,
  );
  return `${selector} {\n  color-scheme: ${colorScheme};\n${lines.join("\n")}\n  --radius: ${RADIUS};\n}`;
}

/** The CSS in `tokens.css` (web and Electron). Generated from the web palettes so both stay in sync. */
export function renderTokensCss(): string {
  return `${[
    "/* Generated by `pnpm --filter @rakazo/ui-tokens generate`. Edit src/index.ts instead. */",
    renderBlock(':root,\n[data-theme="dark"]', "dark", webDarkTokens),
    renderBlock('[data-theme="light"]', "light", webLightTokens),
  ].join("\n\n")}\n`;
}
