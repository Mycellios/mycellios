import { MycelliosLoader } from "./MycelliosLoader";

export function StartupScreen({ state }: { state: "session-pending" | "i18n-pending" }) {
  return (
    <div className="app-startup" data-rakazo-app-state={state} role="status" aria-label="Mycellios">
      <MycelliosLoader />
    </div>
  );
}
