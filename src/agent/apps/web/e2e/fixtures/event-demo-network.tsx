// Protocol/model qualification only. Guest UI is the real SessionApp, tested separately.
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { demoApi, type EventDemoSession } from "../../src/lib/event-demo";
import { useDemoContribution } from "../../src/pages/demo/use-demo-contribution";
import { DemoPresenter } from "../../src/pages/demo/Presenter";
import "../../src/styles.css";
import "../../src/pages/demo/event-demo.css";

i18n.load("en", {}); i18n.activate("en");
function ModelQualification() {
  const api = demoApi("test-only-event");
  const [session, setSession] = useState<EventDemoSession | null>(null), [done, setDone] = useState(false);
  const contribution = useDemoContribution("test-only-event", session?.open === true, () => {});
  useEffect(() => { void api.enter().then(setSession); }, []);
  return <main><h1>Isolated model protocol qualification</h1>
    <textarea aria-label="Message Mico" disabled={!session} />
    <button onClick={() => void contribution.toggle()}>{contribution.snapshot?.running ? "Pause contribution" : "Start contribution"}</button>
    {contribution.linked && <p>Your browser is available to the network.</p>}
    <details><summary>Your browser in the network</summary>
      <button onClick={() => void (async () => { const quote = await api.networkQuote();
        const result = await api.networkTest(crypto.randomUUID(), quote.maximumMicrounits); setDone(result.status === "completed"); })()}>
        {done ? "Real inference completed" : "Test the network"}
      </button>
    </details>
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}>
  {new URLSearchParams(location.search).has("present") ? <DemoPresenter id="test-only-event" /> : <ModelQualification />}
</I18nProvider>);
