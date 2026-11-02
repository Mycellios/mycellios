import { MycelliosLoader } from "./MycelliosLoader";

/** Also rendered in index.html so loading is visible before JavaScript starts. */
export function StartupScreen({ state }: { state: "session-pending" | "i18n-pending" }) {
  return (
    <div className="app-startup" role="status" aria-label="Mycellios" data-rakazo-app-state={state}>
      <MycelliosLoader />
    </div>
  );
}
