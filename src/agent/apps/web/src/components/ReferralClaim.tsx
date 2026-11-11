import { useEffect } from "react";
import { useSpaceRpc } from "../lib/space-rpc";

/** The HttpOnly receipt belongs to the origin; raw attribution never passes through UI state. */
export function ReferralClaim({ userId }: { userId: string }) {
  const rpc = useSpaceRpc();
  useEffect(() => {
    let live = true, running = false, finished = false, attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function claim() {
      if (!live || running || finished) return;
      running = true;
      try {
        const result = await rpc.referrals.redeem({ expectedUserId: userId }, { signal: controller.signal });
        finished = result.status !== "verification_required";
        if (result.status === "awarded" || result.status === "already_awarded") window.dispatchEvent(new Event("mycellios:credits-changed"));
      } catch {
        // Lost responses are safe to retry: the authority commits both awards exactly once.
        if (live && attempts < 3) timer = setTimeout(claim, [1000, 5000, 20000][attempts++]!);
      } finally { running = false; }
    }
    void claim();
    window.addEventListener("online", claim); window.addEventListener("focus", claim);
    return () => { live = false; clearTimeout(timer); controller.abort(); window.removeEventListener("online", claim); window.removeEventListener("focus", claim); };
  }, [rpc, userId]);
  return null;
}
