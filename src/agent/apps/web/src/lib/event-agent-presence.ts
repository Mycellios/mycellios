/** Read-only event heartbeat. It never enrolls, starts compute or submits a model request. */
export function startEventAgentPresence(read: () => Promise<{ open: boolean }>, onClosed: () => void) {
  let stopped = false, busy = false;
  const poll = async () => {
    if (stopped || busy || document.visibilityState === "hidden") return;
    busy = true;
    try {
      const session = await read();
      if (!stopped && !session.open) { stop(); onClosed(); }
    } catch { /* Ordinary connectivity failures retain the existing guest; never reenroll. */ }
    finally { busy = false; }
  };
  const visible = () => { if (document.visibilityState === "visible") void poll(); };
  const timer = window.setInterval(() => { void poll(); }, 10_000);
  function stop() { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visible); }
  document.addEventListener("visibilitychange", visible);
  void poll();
  return stop;
}
