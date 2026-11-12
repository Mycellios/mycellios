import { UI_LOCALES } from "./ui-locale";
import { useSyncExternalStore } from "react";

export const GENERAL_PREFERENCES_KEY = "mycellios.general.v1";
export const CHAT_COLORS = ["#d3939b", "#cf9574", "#dfbc6c", "#79bf89", "#82addb", "#ccaceb", "#d9a4bf", "#edd1c4", "#b7b7b7", "#ffffff"] as const;
export const INTERFACE_FONTS = ["Geist", "Arial", "Verdana", "Georgia", "Trebuchet MS", "system-ui"] as const;
export const CODE_FONTS = ["monospace", "Consolas", "Menlo", "Courier New"] as const;
export const DEFAULT_GENERAL_PREFERENCES = {
  interfaceFont: "Geist", codeFont: "monospace", logoColor: "default", chatColor: "default",
  chatBackgroundLight: "default", chatBackgroundDark: "default",
  compactMessageActions: true, restoreLastWorkspace: true,
  sidebarChatOrder: "manual" as "manual" | "unread-group" | "unread-first",
  speechEngine: "local" as "local" | "provider",
  networkSpeechAccount: "", networkTranscriptionAccount: "",
  dictationLanguage: "auto", speechSpeed: 1, deviceVoice: "default", readReplies: false,
  taskSound: "classic", actionSound: "off",
  productAnalytics: false,
  busyMessageMode: "queue" as "queue" | "steer",
};
export type GeneralPreferences = typeof DEFAULT_GENERAL_PREFERENCES;
let previousRaw: string | null | undefined;
let previous = DEFAULT_GENERAL_PREFERENCES;
const listeners = new Set<() => void>();
const color = (v: unknown) => typeof v === "string" && (v === "default" || CHAT_COLORS.includes(v as typeof CHAT_COLORS[number])) ? v : "default";
const font = (v: unknown, fallback: string) => typeof v === "string" && v.length <= 100 && /^[\p{L}\p{N} ._'()\-+]+$/u.test(v) ? v : fallback;
export function parseGeneralPreferences(raw: string | null): GeneralPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_GENERAL_PREFERENCES };
    return {
      interfaceFont: font(value.interfaceFont, "Geist"),
      codeFont: font(value.codeFont, "monospace"),
      logoColor: color(value.logoColor), chatColor: color(value.chatColor),
      chatBackgroundLight: color(value.chatBackgroundLight), chatBackgroundDark: color(value.chatBackgroundDark),
      sidebarChatOrder: ["manual", "unread-group", "unread-first"].includes(value.sidebarChatOrder) ? value.sidebarChatOrder : "manual",
      compactMessageActions: value.compactMessageActions !== false,
      restoreLastWorkspace: value.restoreLastWorkspace !== false,
      dictationLanguage: UI_LOCALES.includes(value.dictationLanguage) ? value.dictationLanguage : "auto",
      speechSpeed: [0.75, 1, 1.25, 1.5, 2].includes(value.speechSpeed) ? value.speechSpeed : 1,
      speechEngine: value.speechEngine === "provider" ? "provider" : "local",
      networkSpeechAccount: typeof value.networkSpeechAccount === "string" && value.networkSpeechAccount.length <= 128
        ? value.networkSpeechAccount : "",
      networkTranscriptionAccount: typeof value.networkTranscriptionAccount === "string" && value.networkTranscriptionAccount.length <= 128 ? value.networkTranscriptionAccount : "",
      deviceVoice: typeof value.deviceVoice === "string" && value.deviceVoice.length <= 200 ? value.deviceVoice : "default",
      readReplies: value.readReplies === true,
      taskSound: ["off", "classic", "default", "mech", "bubble", "press"].includes(value.taskSound) ? value.taskSound : "classic",
      actionSound: ["off", "default", "mech", "bubble", "press"].includes(value.actionSound) ? value.actionSound : "off",
      productAnalytics: value.productAnalytics === true,
      busyMessageMode: value.busyMessageMode === "steer" ? "steer" : "queue",
    };
  } catch { return { ...DEFAULT_GENERAL_PREFERENCES }; }
}
export function getGeneralPreferences(): GeneralPreferences {
  let raw: string | null = null;
  try { raw = localStorage.getItem(GENERAL_PREFERENCES_KEY); } catch { return previous; }
  if (raw !== previousRaw) { previousRaw = raw; previous = parseGeneralPreferences(raw); }
  return previous;
}
export function setGeneralPreferences(patch: Partial<GeneralPreferences>) {
  const value = parseGeneralPreferences(JSON.stringify({ ...getGeneralPreferences(), ...patch }));
  // A storage failure is an error, not a misleading saved switch.
  localStorage.setItem(GENERAL_PREFERENCES_KEY, JSON.stringify(value));
  previousRaw = undefined;
  applyGeneralPreferences(value);
  listeners.forEach(listener => listener());
}
export function subscribeGeneralPreferences(listener: () => void) {
  listeners.add(listener);
  const sync = (event: StorageEvent) => {
    if (event.key === null || event.key === GENERAL_PREFERENCES_KEY) { applyGeneralPreferences(); listener(); }
  };
  window.addEventListener("storage", sync);
  return () => { listeners.delete(listener); window.removeEventListener("storage", sync); };
}
export function useGeneralPreferences() {
  return useSyncExternalStore(subscribeGeneralPreferences, getGeneralPreferences, () => DEFAULT_GENERAL_PREFERENCES);
}
export function colorForeground(hex: string) {
  const components = hex.slice(1).match(/../g)?.map(v => parseInt(v, 16) / 255) ?? [1, 1, 1];
  const [r, g, b] = components.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? "#111111" : "#ffffff";
}
export function applyGeneralPreferences(value = getGeneralPreferences(), root = document.documentElement) {
  root.style.setProperty("--mycellios-font-family", `"${value.interfaceFont}", system-ui, sans-serif`);
  root.style.setProperty("--font-mono", `"${value.codeFont}", monospace`);
  root.dataset.compactMessageActions = String(value.compactMessageActions);
  for (const [key, css] of [["chatColor", "--custom-chat-user"], ["logoColor", "--custom-logo-color"],
    ["chatBackgroundLight", "--custom-chat-background-light"], ["chatBackgroundDark", "--custom-chat-background-dark"]] as const) {
    if (value[key] === "default") root.style.removeProperty(css);
    else root.style.setProperty(css, value[key]);
  }
  root.dataset.logoColor = value.logoColor === "default" ? "default" : "custom";
  if (value.chatColor === "default") root.style.removeProperty("--custom-chat-user-foreground");
  else root.style.setProperty("--custom-chat-user-foreground", colorForeground(value.chatColor));
}
