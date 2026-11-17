export const DEFAULT_WARM_WINDOW_TTL_MS = 15 * 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function warmWindowTtlMs(value: string | undefined) {
  if (value === undefined || value.trim() === "") return DEFAULT_WARM_WINDOW_TTL_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_TIMER_DELAY_MS
    ? parsed
    : DEFAULT_WARM_WINDOW_TTL_MS;
}

/**
 * The macOS window buttons are drawn over the page, so their position is a layout value. macOS
 * spaces the three 13px buttons 23px apart, so the group is 59px wide: x 12 keeps it inside the
 * 72px page rail (`--rk-rail-width` on macOS), and y 19 puts its centre line on the centre of the
 * 51px top row, (51 - 13) / 2. Change these with that rail and row.
 */
export const MAC_WINDOW_BUTTON_INSET = { x: 12, y: 19 } as const;

function windowChrome(platform: NodeJS.Platform) {
  const mac = platform === "darwin";
  return {
    // Keep in sync with webDarkTokens.background from @rakazo/ui-tokens (asserted in tests).
    // Do not import that package here: desktop packs compiled JS only and ui-tokens is a
    // TypeScript source / devDependency.
    backgroundColor: "#202023",
    show: true,
    autoHideMenuBar: true,
    // Windows and Linux use the standard OS title bar, above the page.
    // macOS hides it and draws the window buttons over the page, as OpenBot does.
    frame: true,
    titleBarStyle: mac ? ("hidden" as const) : undefined,
    trafficLightPosition: mac ? MAC_WINDOW_BUTTON_INSET : undefined,
  };
}

export function browserWindowOptions(platform: NodeJS.Platform) {
  return { width: 1440, height: 900, ...windowChrome(platform) };
}

/**
 * Unpackaged (dev) launches set the dock/taskbar icon by hand. macOS draws the file as-is,
 * so it needs the squircle-with-margins asset; packaged builds already use icon.icns.
 */
export function developmentIconFile(platform: NodeJS.Platform) {
  return platform === "darwin" ? "icon-macos.png" : "icon.png";
}

/** The first-run setup window is smaller and keeps the same host chrome. */
export function setupWindowOptions(platform: NodeJS.Platform) {
  return { width: 720, height: 700, minWidth: 480, minHeight: 560, ...windowChrome(platform) };
}
