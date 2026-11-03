const scenario = new URLSearchParams(location.search).get("case") ?? "verify";
let identified = scenario !== "verify";
let unavailable = scenario === "error";
const actions: string[] = [];
function record(action: string) {
  actions.push(action);
  document.querySelector("output")?.replaceChildren(actions.join(","));
}
// Recovery is tied to the explicit fixture click, so background polling cannot
// erase the error before the browser verifies the Retry control.
document.addEventListener("click", (event) => {
  if ((event.target as Element).closest("button")?.textContent?.trim() === "Reintentar") {
    unavailable = false;
  }
}, { capture: true });
const runtime = {
  async status() {
    return { supported: true, installed: true, enrolled: true, nodeId: identified ? "fixture-node" : null };
  },
  async identify() { record("identify"); identified = true; return this.status(); },
  async enroll() { record("enroll"); throw new Error("Unexpected enrollment"); },
};
const bridge = { runtime };
export function desktopBridge() { return bridge; }
export const rpc = { models: {
  async contributionStatus() {
    record("status");
    if (unavailable) throw new Error("Fixture unavailable");
    return { nodeId: "fixture-node", connected: true, enabled: false, pending: null, rejected: false };
  },
  async contributionControl({ action }: { action: string }) {
    record(`control:${action}`);
    return { nodeId: "fixture-node", connected: true, enabled: false, pending: action, rejected: false };
  },
  async contributionEnrollment() { record("grant"); throw new Error("Unexpected grant"); },
} };
