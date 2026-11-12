import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { AskCard, type AskBlock } from "../../src/components/AskCard";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const block: AskBlock = {
  kind: "ask", approvalEffectId: "fixture-only-no-execution", site: "efe.com",
  text: "Review before web_fetch → efe.com",
  detail: "url: https://www.efe.com/portada-espana/",
  status: params.has("pending") ? "pending" : "answered",
  ...(params.has("pending") ? {} : { answer: "always" }),
  actions: [{ id: "allow", label: "Allow once" }, { id: "always", label: "Always allow" }, { id: "deny", label: "Deny" }],
};
applyResolvedAppearance(params.has("dark") ? "dark" : "light");
void bootstrapI18n("es").then(() => createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <main className="p-5">
      <AskCard block={block} canAnswer canDismiss onAnswer={async () => {}} onDismiss={async () => {}} />
    </main>
  </I18nProvider>,
));
