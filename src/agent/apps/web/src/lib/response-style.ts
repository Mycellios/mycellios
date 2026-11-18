import { createContext, useContext, useEffect, useState } from "react";
import type { RpcClient } from "./rpc";
export type ResponseStyle = "natural" | "classic";

/**
 * The account's Mico response style, as the chat draws it. Natural shows short notes, one steps
 * summary and the complete answer; classic keeps the earlier transcript. Without a provider the
 * transcript stays classic.
 */
export const ResponseStyleContext = createContext<ResponseStyle>("classic");

export function useResponseStyle(): ResponseStyle {
  return useContext(ResponseStyleContext);
}

const CHANGED = "mycellios:response-style";

/** Tells open chats that the saved style changed, so they draw the next turns with it. */
export function announceResponseStyle(style: ResponseStyle): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ResponseStyle>(CHANGED, { detail: style }));
}

/** Reads the saved style for this Space's client; natural, the default, until it loads or on failure. */
export function useSavedResponseStyle(client: Pick<RpcClient, "preferences">): ResponseStyle {
  const [style, setStyle] = useState<ResponseStyle>("natural");
  useEffect(() => {
    let gone = false;
    const read = client.preferences?.micos;
    if (read) {
      void read().then(
        (state) => { if (!gone) setStyle(state.defaults.responseStyle ?? "natural"); },
        () => {},
      );
    }
    const changed = (event: Event) => {
      const next = (event as CustomEvent<ResponseStyle>).detail;
      if (next === "natural" || next === "classic") setStyle(next);
    };
    window.addEventListener(CHANGED, changed);
    return () => { gone = true; window.removeEventListener(CHANGED, changed); };
  }, [client]);
  return style;
}
