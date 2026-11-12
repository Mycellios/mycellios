import { I18nProvider } from "@lingui/react";
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import type { RpcClient } from "../../src/lib/rpc";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import { Composer } from "../../src/pages/shell/composer";
import "../../src/styles.css";

const noop = () => {};
function Fixture() {
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState("");
  const rows = useRef<{ messageId: string; text: string; createdAt: string }[]>([]);
  const client = useMemo(() => ({ threads: { queue: async () => [...rows.current] } }) as unknown as RpcClient, []);
  return <SpaceRpcProvider spaceId="fixture-space" client={client}>
    <main style={{ maxWidth: 800, margin: "auto", padding: 24 }}>
      <p style={{ marginBottom: 24 }}>El Mico está trabajando…</p>
      <Composer artifactTarget={{ botId: "fixture-mico" }} activeName="Mico" running
        busyMessageMode="queue" pendingAttachments={[]} attachmentNotice={null} sendError={null}
        onOpenModels={noop} onOpenConnections={noop} runError={null} runErrorId={null}
        onRunErrorPresented={noop} onDismissError={noop} sending={sending}
        fileInputRef={useRef<HTMLInputElement>(null)} onAttachmentPick={() => true}
        onRemoveAttachment={noop} onStop={async () => {}} draftKey="fixture-busy-composer" enterToSend
        onAskAside={text => setReceipt(`aside:${text}`)}
        onSend={async (text, _mentions, nonce, mode) => {
          setSending(true);
          await new Promise(resolve => setTimeout(resolve, 20));
          if (mode === "queue") rows.current.push({ messageId: nonce, text, createdAt: new Date().toISOString() });
          setReceipt(`${mode}:${text}`); setSending(false); return true;
        }} />
      <output data-testid="delivery-receipt" className="sr-only">{receipt}</output>
    </main>
  </SpaceRpcProvider>;
}
applyResolvedAppearance("light");
void bootstrapI18n("es").then(() => createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Fixture /></I18nProvider>));
