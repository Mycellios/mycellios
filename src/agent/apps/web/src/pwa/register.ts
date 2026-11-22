import { desktopBridge } from "../lib/desktop";
import { appPath } from "../lib/app-path";

type ServiceWorkerHost = Pick<Window, "addEventListener" | "navigator" | "mycelliosDesktop" | "rakazoDesktop">;

/**
 * Production browsers only. Dev must always reach Vite, and Electron serves the
 * renderer itself, so a worker there would shadow the bundled assets.
 */
export function registerServiceWorker(
  target: ServiceWorkerHost = window,
  production: boolean = import.meta.env.PROD,
): void {
  if (!production || desktopBridge(target) || !("serviceWorker" in target.navigator)) return;
  target.addEventListener(
    "load",
    () => {
      target.navigator.serviceWorker.register(appPath("/sw.js")).catch(() => undefined);
    },
    { once: true },
  );
}
