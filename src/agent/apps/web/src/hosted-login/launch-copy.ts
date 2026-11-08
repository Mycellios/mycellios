import type { UiLocale } from "../lib/ui-locale";

export type LaunchMessage = "loading" | "signingIn" | "slow" | "retry";

const COPY: Record<LaunchMessage, Record<UiLocale, string>> = {
  loading: {
    en: "Loading…",
    de: "Wird geladen…",
    ko: "불러오는 중…",
    tr: "Yükleniyor…",
    hi: "लोड हो रहा है…",
    "pt-BR": "Carregando...",
    "zh-CN": "加载中…",
    es: "Cargando…",
    ru: "Загрузка…",
    fr: "Chargement…",
    he: "טוען…",
    nl: "Bezig met laden…",
    ja: "読み込み中…",
  },
  signingIn: {
    en: "Signing in…",
    de: "Anmeldung läuft…",
    ko: "로그인하는 중…",
    tr: "Giriş yapılıyor…",
    hi: "साइन इन हो रहा है…",
    "pt-BR": "Entrando…",
    "zh-CN": "正在登录…",
    es: "Entrando…",
    ru: "Выполняется вход…",
    fr: "Connexion…",
    he: "נכנסים…",
    nl: "Bezig met aanmelden…",
    ja: "サインインしています…",
  },
  slow: {
    en: "This is taking a while.",
    de: "Das dauert etwas länger.",
    ko: "조금 더 걸리고 있습니다.",
    tr: "Biraz uzun sürüyor.",
    hi: "थोड़ा समय लग रहा है.",
    "pt-BR": "Está demorando um pouco.",
    "zh-CN": "比平时久了一点。",
    es: "Está tardando un poco.",
    ru: "Это занимает больше времени.",
    fr: "Cela prend un peu de temps.",
    he: "זה לוקח קצת יותר זמן.",
    nl: "Dit duurt iets langer.",
    ja: "少し時間がかかっています。",
  },
  retry: {
    en: "Retry",
    de: "Erneut versuchen",
    ko: "다시 시도",
    tr: "Yeniden dene",
    hi: "फिर कोशिश करें",
    "pt-BR": "Tentar novamente",
    "zh-CN": "重试",
    es: "Reintentar",
    ru: "Повторить",
    fr: "Réessayer",
    he: "לנסות שוב",
    nl: "Opnieuw proberen",
    ja: "再試行",
  },
};

export function launchText(locale: UiLocale, message: LaunchMessage): string {
  return COPY[message][locale];
}
