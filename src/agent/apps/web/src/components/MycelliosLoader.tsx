import { appPath } from "../lib/app-path";

/** Shared by React waits and the pre-JavaScript startup markup in index.html. */
export function MycelliosLoader() {
  return (
    <span className="app-loading-mark">
      <img src={appPath("/mycellios/loader.svg")} width="76" height="76" alt="" aria-hidden="true" />
      <span>Mycellios</span>
    </span>
  );
}
