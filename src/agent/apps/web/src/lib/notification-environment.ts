/** iPad Safari can identify as macOS; use touch support as well as the user agent. */
export function notificationEnvironment(input: {
  userAgent: string; platform: string; maxTouchPoints: number; secure: boolean;
  installed: boolean; push: boolean; androidHost: boolean; nativeDesktop: boolean;
}): "desktop" | "android-host" | "insecure" | "ios-install" | "push" | "foreground" {
  if (input.nativeDesktop) return "desktop";
  if (input.androidHost) return "android-host";
  if (!input.secure) return "insecure";
  const ios = /iPad|iPhone|iPod/.test(input.userAgent) || (input.platform === "MacIntel" && input.maxTouchPoints > 1);
  if (ios && !input.installed) return "ios-install";
  return input.push ? "push" : "foreground";
}
