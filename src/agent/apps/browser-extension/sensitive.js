// Sites a Mico never reads in the person's Chrome, checked here before any script runs.
// Mycellios itself (so a Mico cannot read or approve its own cards or touch the session),
// the Chrome Web Store, and password-manager vaults. Non-http(s) pages are refused as well.
const REFUSED_HOSTS = [
  "mycellios.com",
  "chromewebstore.google.com",
  "passwords.google.com",
  "1password.com",
  "1password.eu",
  "1password.ca",
  "bitwarden.com",
  "bitwarden.eu",
  "lastpass.com",
  "dashlane.com",
  "keepersecurity.com",
  "keepersecurity.eu",
  "nordpass.com",
  "proton.me",
  "roboform.com",
  "enpass.io",
];

/** Why a page is refused, or null when the person may be asked about it. */
export function refusedPage(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return "not_web_page";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "not_web_page";
  if (url.username || url.password) return "refused_site";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "chrome.google.com" && url.pathname.startsWith("/webstore")) return "refused_site";
  if (REFUSED_HOSTS.some((refused) => host === refused || host.endsWith(`.${refused}`))) return "refused_site";
  return null;
}
