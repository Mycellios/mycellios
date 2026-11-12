import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { MicoWorkMenu } from "../../src/components/MicoWorkMenu";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import type { RpcClient } from "../../src/lib/rpc";
import { messages } from "../../src/locales/es/messages.po";
import "../../src/styles.css";
const i18n=setupI18n({locale:"es",messages:{es:messages}});
// Presentation fixture only; never sends task commands to a live agent.
const client={tasks:{overview:async()=>[],concurrency:async()=>({limit:4,effectiveLimit:4}),
get:async()=>({taskId:"preview",version:1,paused:false,active:false,botId:"preview",runId:"preview",bots:[]}),work:async()=>[]}} as unknown as RpcClient;
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><SpaceRpcProvider spaceId={null} client={client}><main className="min-h-dvh bg-background p-10"><p className="mb-6 text-xs text-muted-foreground">Vista previa · Tareas</p><div className="flex w-80 justify-end"><MicoWorkMenu botId="preview" runId="preview" onOpenTask={()=>{}}/></div></main></SpaceRpcProvider></I18nProvider>);
