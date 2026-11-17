import { I18nProvider } from "@lingui/react";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { Plus } from "lucide-react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DeveloperContextLink } from "../../src/components/DeveloperContextLink";
import { setDeveloperMode, useDeveloperMode } from "../../src/lib/developer-mode";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { QueryUserProvider } from "../../src/lib/query";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";

function Fixture() {
  const [enabled, setEnabled] = useDeveloperMode();
  const [conversation, setConversation] = useState(false);
  return <main className="min-h-screen bg-background text-foreground">
    <header data-testid="conversation-header" className="rk-conversation-header @container flex h-[51px] items-center gap-2 border-b border-border px-3 max-md:h-14">
      <Button variant="ghost" size="sm" className="gap-1.5 font-normal"><BotAvatar color="#b75450" identity="fixture-mico" size={22} />Vídeos</Button>
      <DeveloperContextLink botId="fixture-mico" spaceId="fixture-space" threadId={conversation ? "fixture-thread-2" : "fixture-thread-1"}
        taskThreadId={conversation ? "fixture-thread-2" : undefined} runId={conversation ? "fixture-run-2" : "fixture-run-1"} />
      <span className="hidden min-w-0 truncate border-s border-border ps-3 text-sm md:block">Revisar el vídeo</span>
      <Button variant="ghost" size="icon-sm" className="ms-auto" aria-label="Nueva conversación" onClick={() => setConversation(v => !v)}><Plus size={16} /></Button>
    </header>
    <section className="flex gap-3 p-5 text-sm">
      <label className="flex items-center gap-2"><input aria-label="Modo desarrollador" type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Modo desarrollador</label>
      <Button size="sm" variant="ghost" onClick={() => applyResolvedAppearance(document.documentElement.dataset.theme === "dark" ? "light" : "dark")}>Cambiar tema</Button>
    </section>
  </main>;
}
const userId = "fixture-owner";
applyResolvedAppearance("light");
if (!localStorage.getItem(`mycellios.developerMode:${userId}`)) setDeveloperMode(userId, false);
void bootstrapI18n("es").then(() => createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}><QueryUserProvider value={userId}><Fixture /></QueryUserProvider></I18nProvider>,
));
