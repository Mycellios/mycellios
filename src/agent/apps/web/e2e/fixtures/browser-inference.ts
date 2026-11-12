import { initializeMobileWorker, startMobileWorker, stopMobileWorker, subscribeMobileWorker,
  getMobileWorkerAccountProof } from "../../../../../mobile/runtime";
const el = (id: string) => document.getElementById(id)!;
let running = false, linked: string | null = null, requesting = false;
async function call(path: string, body?: unknown) {
  const response = await fetch("/__browser-inference-test/" + path, { method: body ? "POST" : "GET",
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Test request failed"); return value;
}
async function balance() {
  const value = await call("balance");
  el("earned").textContent = (value.earned / 1_000_000).toFixed(6);
  el("buyer").textContent = "Saldo del solicitante de prueba: " + (value.buyer / 1_000_000).toFixed(6);
}
initializeMobileWorker({ embedded: true });
subscribeMobileWorker(snapshot => {
  running = snapshot.running; el("power").textContent = running ? "Pausar" : "Activar";
  el("status").textContent = snapshot.running ? `${snapshot.connection} · ${snapshot.backend} · ${snapshot.verifiedTasks} verificadas` : "Pausado";
  const proof = getMobileWorkerAccountProof();
  if (proof && proof.workerId !== linked) {
    linked = proof.workerId;
    void call("bind", proof).catch(error => { el("result").textContent = error.message; });
  }
  (el("text-infer") as HTMLButtonElement).disabled = requesting || !snapshot.running || snapshot.verifiedTasks < 1;
});
el("power").onclick = async () => { if (running) { await stopMobileWorker(); linked = null; } else await startMobileWorker(); };
el("text-infer").onclick = async () => {
  requesting = true;
  (el("text-infer") as HTMLButtonElement).disabled = true;
  el("answer").textContent = "Generando en el navegador y verificando el resultado…";
  try {
    const response = await fetch("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json",
      "x-local-test-account": "test-buyer", "x-mycellios-funding": "contribution-credits", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ model: "mycellios-browser/gpt2", messages: [{role:"user", content:(el("prompt") as HTMLTextAreaElement).value}], max_tokens:24, temperature:0 }) });
    const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value));
    el("answer").textContent = value.choices[0].message.content;
    el("result").textContent = JSON.stringify(value,null,2); await balance();
  } catch(error) { el("answer").textContent = String(error); }
  finally { requesting = false; (el("text-infer") as HTMLButtonElement).disabled = !running; }
};
window.addEventListener("mycellios:contribution-changed", () => { void balance(); });
window.addEventListener("mycellios:contribution-verified", () => { void balance(); });
void balance();
