import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { PageLoading } from "../../components/PageLoading";
import { demoApi } from "../../lib/event-demo";
import { saveEventAgentContext, type EventAgentContext } from "../../lib/event-demo-agent";
import { appPath } from "../../lib/app-path";
import { DemoPresenter } from "./Presenter";
import "./event-demo.css";

export function EventDemoPage({ id, presenter }: { id: string; presenter: boolean }) {
  return presenter ? <DemoPresenter id={id} /> : <EnterAgent id={id} />;
}
// StrictMode and repeated renders share admission; no model or paid request runs here.
const entries = new Map<string, Promise<EventAgentContext>>();
async function enter(id: string) {
  const api = demoApi(id);
  try { await api.session(); }
  catch (error) { if ((error as Error).message !== "demo_session_required") throw error; await api.enter(); }
  const ticket = await api.agentTicket();
  const response = await fetch(appPath("/api/demo/enter"), { method: "POST", credentials: "same-origin",
    cache: "no-store", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify(ticket) });
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error?.code ?? "demo_agent_unavailable");
  return value as EventAgentContext;
}
function EnterAgent({ id }: { id: string }) {
  const { t } = useLingui();
  const [issue, setIssue] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    setIssue(false);
    let pending = entries.get(id);
    if (!pending) { pending = enter(id); entries.set(id, pending); }
    void pending.then(value => {
      if (stopped) return;
      saveEventAgentContext(value);
      window.location.replace(appPath("/app/" + encodeURIComponent(value.botId)));
    }).catch(() => { entries.delete(id); if (!stopped) setIssue(true); });
    return () => { stopped = true; };
  }, [id, attempt]);
  if (!issue) return <PageLoading />;
  return <main className="rk-demo"><div className="rk-demo-welcome" role="alert">
    <h1>{t`Mycellios`}</h1><p>{t`We couldn't open your demo. It may have ended or all places may be taken.`}</p>
    <Button onClick={() => setAttempt(value => value + 1)}>{t`Try again`}</Button>
  </div></main>;
}
