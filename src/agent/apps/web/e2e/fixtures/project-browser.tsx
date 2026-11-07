import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReviewWorkspaceProvider, useReviewWorkspace } from "../../src/lib/review-workspace";
import { ReviewWorkspacePanel } from "../../src/components/ReviewWorkspacePanel";
import { messages } from "../../src/locales/es/messages.po";
import "../../src/styles.css";
i18n.load("es",messages);i18n.activate("es");
function Workspace(){
  const review=useReviewWorkspace()!;
  const [draft,setDraft]=useState("");
  useEffect(()=>{
    const url=new URL(location.href).searchParams.get("preview")!;
    if(url) review.add({id:"fixture",name:"Proyecto local",mimeType:"text/uri-list",url});
  },[]);
  useEffect(()=>{if(review.draft){setDraft(review.draft.text);review.consumeDraft(review.draft.id);}},[review.draft]);
  return <div className="relative flex h-dvh min-h-0 min-w-0 bg-background text-foreground">
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border p-4 text-sm font-medium">Proyecto de ejemplo · Prueba local
        <button type="button" onClick={review.show}>Abrir navegador</button>
      </header>
      <div className="flex-1 p-6 text-sm"><p>Revisa la página y selecciona el botón que quieras cambiar.</p></div>
      <div className="border-t border-border p-4"><label htmlFor="fixture-draft" className="text-sm">Borrador del chat</label><textarea id="fixture-draft" aria-label="Borrador del chat" value={draft} onChange={event=>setDraft(event.target.value)} rows={5} className="mt-2 w-full resize-none rounded-lg border border-border bg-background p-3 text-sm"/></div>
    </main>
    <ReviewWorkspacePanel agentName="Proyecto de ejemplo"/>
  </div>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><ReviewWorkspaceProvider scope="fixture-chat"><Workspace/></ReviewWorkspaceProvider></I18nProvider>);
