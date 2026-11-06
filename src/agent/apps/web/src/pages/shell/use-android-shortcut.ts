import { useEffect, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { androidChatReady, takeAndroidShortcut } from "../../lib/android-host";

/** Route/query changes must not tear down the native recorder's chat ownership. */
export function useAndroidShortcut(setSearchParams: SetURLSearchParams) {
  const setter = useRef(setSearchParams);
  setter.current = setSearchParams;
  useEffect(() => {
    const request = () => {
      if (takeAndroidShortcut()) setter.current(previous => {
        const next = new URLSearchParams(previous); next.set("dictate", "1"); return next;
      }, { replace: true });
    };
    window.addEventListener("mycellios:dictate", request);
    request(); androidChatReady(true);
    return () => { window.removeEventListener("mycellios:dictate", request); androidChatReady(false); };
  }, []);
}
