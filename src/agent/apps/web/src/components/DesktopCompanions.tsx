import { useLingui } from "@lingui/react/macro";
import { companionAvatar } from "../lib/companion-avatar";
import { desktopQuestionAnswerText, type DesktopQuestionPrompt, type DesktopQuestionRequest } from "@rakazo/contracts";
import { companionQuestions } from "../lib/companion-questions";
import { rpc } from "../lib/rpc";
import type { Bot } from "@rakazo/contracts";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { desktopBridge } from "../lib/desktop";

export function DesktopCompanions({ bots, spaceId, scope, onOpen }: {
  bots: Bot[]; spaceId: string | null; scope: string;
  onOpen?: (spaceId: string, path: string) => void;
}) {
  const navigate = useNavigate();
  const { t, i18n } = useLingui();
  const bridge = desktopBridge()?.companions;
  const requestScope = useRef(scope);
  requestScope.current = scope;
  useEffect(() => {
    if (!bridge?.onQuestion || !bridge.questionResult) return;
    return bridge.onQuestion(async (request: DesktopQuestionRequest) => {
      const current = () => requestScope.current === scope && request.scope === scope;
      if (!current()) return;
      let outcome: "ok" | "stale" | "error" = "error";
      try {
        const bot = bots.find(bot => bot.id === request.prompt.botId && bot.spaceId === spaceId && !bot.archivedAt);
        if (!bot) outcome = "stale";
        else {
          const snapshot = await rpc.threads.get({ botId: bot.id });
          if (!current()) return;
          const prompt = companionQuestions(bot.id, snapshot).find(prompt => prompt.id === request.promptId);
          if (!prompt) outcome = "stale";
          else {
            const answer = desktopQuestionAnswerText(prompt, request);
            if (!current()) return;
            await rpc.threads.answer({ botId: bot.id, runId: prompt.runId, messageId: prompt.messageId, answer, clientNonce: request.nonce });
            outcome = "ok";
          }
        }
      } catch { /* No server details, answer text or credentials go back to an OS surface. */ }
      if (current()) await bridge.questionResult!({ nonce: request.nonce, scope, outcome }).catch(() => undefined);
    });
  }, [bridge, bots, spaceId, scope]);
  useEffect(() => {
    // Revoke the previous account immediately, before asynchronous avatar work.
    // A Space switch keeps same-account floating chats while its dock refreshes.
    void bridge?.publish({ scope, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", agents: [] }).catch(() => undefined);
  }, [bridge, scope]);
  useEffect(() => {
    // Revoke the previous account immediately, before asynchronous avatar work.
    // A Space switch keeps same-account floating chats while its dock refreshes.
    void bridge?.publish({ scope, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", agents: [] }).catch(() => undefined);
  }, [bridge, scope]);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    let publishing = false;
    const publish = async () => {
      if (!alive || publishing) return;
      publishing = true;
      try {
      const questions: DesktopQuestionPrompt[] = [];
      const islandEnabled = Boolean(bridge.onQuestion && (await bridge.state()).island.shown);
      if (islandEnabled) {
        const waiting = bots.filter(bot => !bot.archivedAt && bot.spaceId === spaceId && bot.status === "waiting_input").slice(0, 20);
        for (let offset = 0; offset < waiting.length && alive; offset += 4) {
          await Promise.all(waiting.slice(offset, offset + 4).map(async bot => {
            try { const snapshot = await rpc.threads.get({ botId: bot.id });
              if (alive) questions.push(...companionQuestions(bot.id, snapshot));
            } catch { /* A disconnected Space exposes no cached questions. */ }
          }));
        }
      }
      questions.sort((a, b) => bots.findIndex(bot => bot.id === a.botId) - bots.findIndex(bot => bot.id === b.botId) || a.id.localeCompare(b.id));
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
      if (alive) void bridge.publish({ scope, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", agents, palette,
        ...(bridge.onQuestion ? { questions: questions.slice(0, 32), labels: {
          questions: t`Questions`, asks: t`asks`, later: t`Later`, open: t`Answer in Mycellios`,
          placeholder: t`Or write your own answer`, more: t`more requests`, send: t`Send answer`,
          error: t`Could not confirm the answer. Open the chat before retrying.`, next: t`Next`,
        } } : {}),
      }).catch(() => undefined);
      } finally { publishing = false; }
    };
    void publish().catch(() => undefined);
    const timer = window.setInterval(() => { void publish().catch(() => undefined); }, 8000);
    const preferencesChanged = () => { void publish().catch(() => undefined); };
    window.addEventListener("mycellios:companion-preferences", preferencesChanged);
    const observer = new MutationObserver(() => { void publish().catch(() => undefined); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const off = bridge.onSelect(target => {
      try {
        const owner = JSON.parse(scope), destination = JSON.parse(target.scope);
        if (!Array.isArray(destination) || destination[0] !== owner[0] || typeof destination[1] !== "string") return;
        if (onOpen) onOpen(destination[1], `/app/${encodeURIComponent(target.botId)}${target.respond ? "?respond=1" : ""}`);
        else if (target.scope === scope && bots.some(bot => bot.id === target.botId && bot.spaceId === spaceId && !bot.archivedAt)) {
          void navigate(`/app/${encodeURIComponent(target.botId)}${target.respond ? "?respond=1" : ""}`);
        }
      } catch { /* A stale account scope cannot navigate another account. */ }
    });
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("mycellios:companion-preferences", preferencesChanged); observer.disconnect(); off(); };
  }, [bridge, bots, spaceId, scope, navigate, onOpen, i18n.locale]);
  useEffect(() => () => {
    void bridge?.publish({ scope: "", theme: "light", agents: [] }).catch(() => undefined);
  }, [bridge]);
  return null;
}
