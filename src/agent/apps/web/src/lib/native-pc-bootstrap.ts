import { desktopBridge } from "./desktop";
import { nativeComputerAdmission, nativeComputerFetch } from "./native-computer-execution";
import { prepareNativeWorkspace } from "./native-computer-workspace";

// Native main owns consent, account identity and OS credentials; hosted browsers have no bridge.
const computer = desktopBridge()?.computer;
if (computer?.connect && computer.connected && computer.projectAvailable) {
  const match = window.location.pathname.match(/^(.*)\/app(?:\/|$)/);
  if (match) {
    const base = match[1] ?? "";
    const send = window.fetch.bind(window);
    const admit = nativeComputerAdmission(computer, (botId) =>
      prepareNativeWorkspace(send, window.location.origin, base, window.localStorage.getItem("rakazo:space-id"), botId),
    );
    window.fetch = nativeComputerFetch(
      send,
      computer,
      window.location.origin,
      base,
      admit,
    );
    const connectChat = () => {
      const prefix = `${base}/app/`;
      const path = window.location.pathname;
      if (!path.startsWith(prefix)) return;
      const id = path.slice(prefix.length);
      if (!/^[a-zA-Z0-9_-]{1,256}$/.test(id)) return;
      // Opening another owned chat binds its workspace; no project folder is required.
      // A declined prompt remains enforced again before any message can be submitted.
      void admit(id).catch(() => undefined);
    };
    for (const method of ["pushState", "replaceState"] as const) {
      const original = window.history[method].bind(window.history);
      window.history[method] = (...args: Parameters<History[typeof method]>) => {
        original(args[0], args[1], args[2]);
        connectChat();
      };
    }
    window.addEventListener("popstate", connectChat);
    connectChat();
  }
}
