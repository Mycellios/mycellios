/** Forward only the event's scoped guest capability, never normal Agent cookies. */
export function eventDemoProxyCookie(url: string, header: string | undefined): string | undefined {
  if (!/^\/mobile\/v1\/demo\/[a-z0-9-]{8,64}(?:\/|$)/.test(url.split("?")[0] ?? "")) return;
  return header?.split(";").map(part => part.trim())
    .filter(part => /^(?:__Secure-mycellios-demo|mycellios-demo-local)=[A-Za-z0-9_.-]{1,120}$/.test(part)).join("; ") || undefined;
}
