/**
 * Forward only the scoped guest capability of the path being proxied (an event's demo cookie or
 * the registration-free guest chat cookie), never normal Agent cookies.
 */
export function eventDemoProxyCookie(url: string, header: string | undefined): string | undefined {
  const path = url.split("?")[0] ?? "";
  const cookie = /^\/mobile\/v1\/demo\/[a-z0-9-]{8,64}(?:\/|$)/.test(path) ? /^(?:__Secure-mycellios-demo|mycellios-demo-local)=[A-Za-z0-9_.-]{1,120}$/
    : /^\/mobile\/v1\/guest(?:\/|$)/.test(path) ? /^(?:__Secure-mycellios-guest|mycellios-guest-local)=[A-Za-z0-9_.-]{1,160}$/
      : undefined;
  if (!cookie) return;
  return header?.split(";").map(part => part.trim()).filter(part => cookie.test(part)).join("; ") || undefined;
}
