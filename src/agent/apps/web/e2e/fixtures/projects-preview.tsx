import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProjectSummary } from "@rakazo/contracts";
import type { RpcClient } from "../../src/lib/rpc";
import { SidebarProjects } from "../../src/components/SidebarProjects";
import { Composer } from "../../src/pages/shell/composer";
import { Menu } from "lucide-react";
import "../../src/styles.css";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });
let saved: ProjectSummary[] = new URLSearchParams(location.search).has("demo") ? [{ id: crypto.randomUUID(), name: "Example app", conversations: [
  { botId: "developer", title: "Improve login", threadId: "preview-login", unread: false },
  { botId: "developer", title: "Test payments", threadId: "preview-payments", unread: false },
] }] : [];
function Preview() {
  const [projects, setProjects] = useState(saved), [creating, setCreating] = useState(false);
  const [chat, select] = useState(""), [mobileOpen, setMobileOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rpc = { development: {
    saveProject: async (input: { id: string; name: string }) => { saved.push({ ...input, conversations: [] }); return { id: input.id }; },
    open: async (input: { botId: string; title: string; taskKey: string; projectKey: string }) => {
      const project = saved.find(p => `project:${p.id}` === input.projectKey)!;
      project.conversations.push({ botId: input.botId, title: input.title, threadId: input.taskKey, unread: false });
      return { threadId: input.taskKey };
    },
  } } as unknown as RpcClient;
  return <main className="flex h-dvh min-w-0 bg-background text-foreground">
    <aside className={`rk-scroll w-64 min-w-0 shrink-0 overflow-y-auto border-e border-border bg-sidebar p-2 max-[600px]:absolute max-[600px]:inset-y-0 max-[600px]:start-0 max-[600px]:z-40 ${mobileOpen ? "" : "max-[600px]:hidden"}`}>
      <header className="flex items-center justify-between p-2"><strong>Mycellios</strong><button aria-label="New project" onClick={() => setCreating(true)}>+</button></header>
      <SidebarProjects rpc={rpc} bots={[{ id: "developer", name: "Developer" }, { id: "reviewer", name: "Reviewer" }]} projects={projects} creating={creating} onCreating={setCreating} activeThread={chat}
        onRefresh={() => setProjects([...saved])} failed={false} onSelect={(_, id) => { select(id); setMobileOpen(false); }} />
      <div className="p-2 text-sm text-muted-foreground">Micos</div><button onClick={() => select("")} className="w-full rounded-lg p-2 text-start text-sm">Personal assistant</button>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-w-0 items-center gap-2 border-b border-border p-4 text-sm"><button className="min-[600px]:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(!mobileOpen)}><Menu size={18} /></button><span className="truncate" data-testid="active-conversation">{projects.flatMap(p => p.conversations).find(c => c.threadId === chat)?.title ?? "Personal assistant"}</span></header>
      <div className="flex-1 p-4 text-sm text-muted-foreground">Local UI fixture · no model or production connection</div>
      <Composer key={chat} draftKey={chat ? `bot:developer:task:${chat}` : "bot:personal"} activeName="Developer" artifactTarget={{ botId: "developer" }}
        running={false} sending={false} pendingAttachments={[]} attachmentNotice={null} sendError={null} runError={null} runErrorId={null}
        onOpenModels={() => {}} onOpenConnections={() => {}} onRunErrorPresented={() => {}} onDismissError={() => {}}
        fileInputRef={fileInputRef} onAttachmentPick={() => false} onRemoveAttachment={() => {}} onSend={async () => false} onStop={async () => {}} enterToSend={false} />
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Preview /></I18nProvider>);
