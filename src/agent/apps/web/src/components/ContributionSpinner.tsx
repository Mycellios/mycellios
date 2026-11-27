/** Setting up contribution: a thin green arc turning over a soft track. */
export function ContributionSpinner() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="rk-contribution-spinner">
    <circle className="track" cx="12" cy="12" r="9" />
    <circle className="arc" cx="12" cy="12" r="9" pathLength="100" />
  </svg>;
}
