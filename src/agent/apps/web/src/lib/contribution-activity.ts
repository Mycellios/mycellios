const indicators = new Set<symbol>();
export function setContributionActivity(key: symbol, active: boolean) {
  if (active) indicators.add(key); else indicators.delete(key);
  const value = indicators.size > 0;
  if ((document.body.dataset.mycelliosContributing === "true") === value) return;
  document.body.dataset.mycelliosContributing = String(value);
  window.dispatchEvent(new Event("mycellios:contribution-activity"));
}
