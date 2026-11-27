import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { Bot, ComputerMode, ComputerStatus } from "@mycellios/contracts";
import { Button } from "@mycellios/ui-web";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { messages as spanish } from "../../src/locales/es/messages.po";
import { ComputerModeNote, ComputerModePicker } from "../../src/pages/shell/bot-panel";
import { ComputerOverlay } from "../../src/pages/shell/computer-overlay";
import "../../src/styles.css";

// Real controls/overlay, synthetic state only. This fixture never boots a provider.
const params = new URLSearchParams(location.search);
const locale = params.get("lang") === "es" ? "es" : "en";
i18n.load(locale, locale === "es" ? spanish : {}); i18n.activate(locale);
const calls: string[] = [];
Object.assign(window, { __isolatedFixture: { calls } });
const noop = () => undefined;
const noopAsync = async () => undefined;
const bot = { id: "fixture-private-mico", name: "Ada", color: "#399e7b", status: "idle" } as Bot;

function Fixture() {
  const [mode, setMode] = useState<ComputerMode>("isolated");
  const [open, setOpen] = useState(false);
  const [control, setControl] = useState(false);
  const blocked = params.has("blocked");
  const computer: ComputerStatus = {
    botId: bot.id, mode: "isolated", kind: "docker", state: "running",
    controlHolder: control ? "user" : "none", controlBotId: null,
    takeoverRequested: false, screenAvailable: true, screenWidth: 1280, screenHeight: 800,
    homeRevision: null, busyBotName: blocked ? "Another Mico" : null, canUpdate: false, terminalAvailable: true,
  };
  return <main className="min-h-dvh bg-background p-5 text-foreground">
    <p className="mb-8 text-xs text-muted-foreground">Synthetic qualification · no account, computer or inference</p>
    <section className="@container mx-auto max-w-xl">
      <h1 className="mb-4 text-lg">{locale === "es" ? "Ordenador" : "Computer"}</h1>
      <ComputerModePicker value={mode} desktopAvailable={false} onChange={next => { calls.push(`mode:${next}`); setMode(next); }} />
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground"><ComputerModeNote mode={mode} desktopAvailable={false} /></p>
      <Button className="mt-6" onClick={() => { calls.push("preview"); setOpen(true); }}>Open synthetic screen</Button>
    </section>
    {open ? <ComputerOverlay bot={bot} computer={computer} computerViewport={null}
      recordingSkill={null} teachBusy={false} hasControl={control} composerRunning={blocked}
      sending={false} booting={false} runStatus={blocked ? params.get("blocked") === "approval" ? "waiting_input" : "running" : undefined}
      sendError={null} embeddedScreenUrl="/novnc/isolated-fixture" screenFrameRef={noop}
      computerScreenError={null} computerBooting={null} onStopTeaching={noop} onStopRun={noop}
      onRelease={async () => { calls.push("release"); setControl(false); }}
      onTakeControl={() => { calls.push("take-control"); setControl(true); }} onStart={noop}
      onRefreshTeaching={noopAsync} onRefreshComputer={noopAsync} onClose={() => setOpen(false)} /> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Fixture /></I18nProvider>);
