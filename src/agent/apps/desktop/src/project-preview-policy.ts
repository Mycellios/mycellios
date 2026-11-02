/** Only the installed native session may frame an opted-in loopback project. */
export function desktopProjectPolicy(url: string, resourceType: string, policy: string) {
  let target: URL;
  try { target = new URL(url); } catch { return policy; }
  if (resourceType !== "mainFrame" || target.origin !== "https://www.mycellios.com" || !target.pathname.startsWith("/agent/") || !policy) return policy;
  const local = "http://127.0.0.1:* http://localhost:*";
  if (/(^|;)\s*frame-src\s/i.test(policy)) return policy.replace(/(^|;)(\s*frame-src\s+)([^;]*)/i, (_all, separator, name, sources) => `${separator}${name}${sources.replace(/'none'/g, "").trim()} ${local}`);
  return `${policy}; frame-src 'self' ${local}`;
}
