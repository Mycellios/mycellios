// Sites a Mico never reads in the person's Chrome, checked here before any script runs.
// Mycellios itself (so a Mico cannot read or approve its own cards or touch the session),
// the Chrome Web Store, and password-manager vaults. Non-http(s) pages are refused as well.
export const REFUSED_HOSTS = [
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
  if (REFUSED_HOSTS.some((refused) => host === refused || host.endsWith(`.${refused}`)))
    return "refused_site";
  return null;
}

// Browser consent (specs/agent-chrome-tabs, "Mandatory confirmations"). These classifiers run in
// the extension at execution time, on a plain description of the element a page script reports,
// so neither the server, the framed app nor an injected page can skip the question. They are
// heuristics and a floor, not a guarantee: a field they cannot recognise is not asked about,
// and a field they are unsure of is asked about.

/** Sign-in and authorization pages: the person decides whether a Mico may continue there. */
const IDENTITY_HOSTS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "auth0.com",
  "okta.com",
  "oktapreview.com",
  "onelogin.com",
  "login.salesforce.com",
  "id.atlassian.com",
];
/** Pages whose frames or addresses take card details. */
const PAYMENT_HOSTS = [
  "js.stripe.com",
  "checkout.stripe.com",
  "paypal.com",
  "paypalobjects.com",
  "adyen.com",
  "braintreegateway.com",
  "pay.google.com",
  "checkout.com",
  "squareup.com",
  "klarna.com",
  "mercadopago.com",
  "redsys.es",
];
const hostOf = (value) => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
};
const underHost = (host, list) => list.some((item) => host === item || host.endsWith(`.${item}`));
export const isPaymentHost = (address) => underHost(hostOf(address), PAYMENT_HOSTS);

/** An OAuth/SSO authorization address, or an identity provider's own pages. */
export function isSignInAddress(address) {
  let url;
  try {
    url = new URL(address, "https://placeholder.invalid/");
  } catch {
    return false;
  }
  if (url.hostname === "placeholder.invalid") return false;
  if (underHost(url.hostname.toLowerCase().replace(/\.$/, ""), IDENTITY_HOSTS)) return true;
  const params = url.searchParams;
  if (
    params.has("client_id") &&
    (params.has("response_type") || params.has("redirect_uri") || params.has("scope"))
  )
    return true;
  return (
    /\/(oauth2?|authorize|saml|sso|openid-connect)(\/|$)/i.test(url.pathname) &&
    params.has("redirect_uri")
  );
}

const PASSWORD_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code)\b/i;
const PASSWORD_NAME =
  /\b(pass(word|code|wd)?|pwd|otp|2fa|mfa)\b|one.?time|verification.?code|c[oó]digo.?de.?verificaci/i;
const PAYMENT_AUTOCOMPLETE = /\bcc-[a-z-]+\b/i;
const PAYMENT_NAME =
  /card.?(num|holder|name)|credit.?card|\bcc.?(num|exp|csc)|\bcv[cv]\b|security.?code|\biban\b|expir|tarjeta|n[uú]mero.?de.?tarjeta/i;

/**
 * What typing into a field needs: "password" (a password, one-time or verification code),
 * "payment" (card number, expiry, security code, IBAN) or null. `field` describes the element:
 * { type, autocomplete, name, id, label }.
 */
export function fieldConsentClass(field) {
  const type = String(field?.type ?? "").toLowerCase();
  const autocomplete = String(field?.autocomplete ?? "");
  if (PAYMENT_AUTOCOMPLETE.test(autocomplete)) return "payment";
  if (type === "password" || PASSWORD_AUTOCOMPLETE.test(autocomplete)) return "password";
  const names = `${field?.name ?? ""} ${field?.id ?? ""} ${field?.label ?? ""}`;
  if (PAYMENT_NAME.test(names)) return "payment";
  if (PASSWORD_NAME.test(names)) return "password";
  return null;
}

const PAY_WORDS =
  /\b(pay|buy|purchase|place.?order|complete.?(order|purchase)|checkout|pagar|comprar|confirmar.?(pedido|compra)|finalizar.?(pedido|compra))\b/i;

/**
 * What a click, or Enter inside a form, needs: "sign_in" (submits a form with a password field, or
 * goes to an identity provider or authorization address), "payment" (submits a form with card
 * fields, or a pay button on a page that embeds a payment provider) or null. `target`:
 * { submitsForm, formHasPassword, formHasPayment, href, text, pageHasPaymentFrame }.
 */
export function clickConsentClass(target) {
  if (target?.submitsForm && target.formHasPayment) return "payment";
  if (target?.submitsForm && target.formHasPassword) return "sign_in";
  if (target?.href && isSignInAddress(target.href)) return "sign_in";
  if (target?.pageHasPaymentFrame && PAY_WORDS.test(String(target.text ?? ""))) return "payment";
  return null;
}

/** The consent class of one action, from the description the page script gives of its element. */
export function actionConsentClass(action, description) {
  if (!description) return null;
  if (action.kind === "fill" || action.kind === "type") return fieldConsentClass(description.field);
  if (action.kind === "click") return clickConsentClass(description.target);
  if (action.kind === "key" && /^enter$/i.test(action.key ?? "")) {
    // Enter inside a field submits its form.
    return clickConsentClass({
      ...description.target,
      submitsForm: description.target?.inForm === true,
    });
  }
  return null;
}
