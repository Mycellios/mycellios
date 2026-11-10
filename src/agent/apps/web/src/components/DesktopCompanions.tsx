import { useLingui } from "@lingui/react/macro";
import { companionAvatar } from "../lib/companion-avatar";
import type { Bot } from "@rakazo/contracts";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { desktopBridge } from "../lib/desktop";

export function DesktopCompanions({ bots, spaceId, scope }: { bots: Bot[]; spaceId: string | null; scope: string }) {
  const navigate = useNavigate();
  const { t, i18n } = useLingui();
  const bridge = desktopBridge()?.companions;
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const publish = async () => {
      if (!alive) return;
      const agents = await Promise.all(bots.filter(bot => !bot.archivedAt && bot.spaceId === spaceId).slice(0, 100).map(async bot => {
        const working = ["working", "running", "queued", "leased", "busy", "thinking"].includes(bot.status);
        return { id: bot.id, name: bot.name.slice(0, 120),
          color: /^#[a-f\d]{6}/i.test(bot.color) ? bot.color.slice(0, 7) : "#3f9f78",
          status: working ? t`Working…` : ["waiting_input", "waiting_takeover"].includes(bot.status) ? t`Needs your attention` : t`Ready`,
          result: bot.preview.slice(0, 300), working, unread: bot.unread, avatar: await companionAvatar(bot.color, bot.id) };
      }));
      const styles = getComputedStyle(document.documentElement);
      const colors = { surface: styles.getPropertyValue("--muted").trim(), foreground: styles.getPropertyValue("--foreground").trim(),
        hover: styles.getPropertyValue("--accent").trim(), muted: styles.getPropertyValue("--muted-foreground").trim() };
      const palette = Object.values(colors).every(color => /^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/.test(color)) ? colors : undefined;
      if (alive) void bridge.publish({ scope, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", agents, palette }).catch(() => undefined);
    };
    publish();
    const observer = new MutationObserver(publish);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const off = bridge.onSelect(target => {
      if (target.scope === scope && bots.some(bot => bot.id === target.botId && bot.spaceId === spaceId && !bot.archivedAt)) void navigate(`/app/${encodeURIComponent(target.botId)}`);
    });
    return () => { alive = false; observer.disconnect(); off(); };
  }, [bridge, bots, spaceId, scope, navigate, i18n.locale]);
  useEffect(() => () => {
    void bridge?.publish({ scope: "", theme: "light", agents: [] }).catch(() => undefined);
  }, [bridge, scope]);
  return null;
}
