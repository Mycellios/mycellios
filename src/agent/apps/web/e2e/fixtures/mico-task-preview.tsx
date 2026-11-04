import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MicoTaskTabs } from "../../src/components/MicoTaskTabs";
import type { RpcClient } from "../../src/lib/rpc";
import "../../src/styles.css";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });
const rows = [
  { threadId: "task-one", title: "Review API" },
  { threadId: "task-two", title: "A task with a deliberately long project and functionality name" },
];
const rpc = { development: {
  list: async () => rows,
  open: async (input: { botId: string; taskKey: string; title: string }) => {
    if (input.botId !== "mico-fixture") throw new Error("Wrong Mico");
    const row = { threadId: input.taskKey, title: input.title };
    rows.push(row); return row;
  },
} } as unknown as RpcClient;

function Preview() {
  const [threadId, select] = useState<string>();
  return <main className="mx-auto flex h-dvh max-w-3xl flex-col bg-background p-4 text-foreground">
    <header className="mb-4 text-sm font-medium">Mycellios · Mico</header>
    <MicoTaskTabs key={threadId ?? "main"} botId="mico-fixture" taskThreadId={threadId} rpc={rpc} onSelect={select} />
    <section className="flex-1 p-4" data-testid="active-task">{threadId ?? "Main chat"}</section>
    <div className="rounded-xl border p-3 text-sm">Message to Mico</div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Preview /></I18nProvider>);
