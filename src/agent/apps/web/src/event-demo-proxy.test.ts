import { expect, it } from "vitest";
import { eventDemoProxyCookie } from "./event-demo-proxy.js";
it("forwards only the narrowly scoped demo cookie to the browser coordinator", () => {
  const header = "better-auth.session_token=private; __Secure-mycellios-demo=guest.proof; other=secret";
  expect(eventDemoProxyCookie("/mobile/v1/demo/test-only-event/session", header)).toBe("__Secure-mycellios-demo=guest.proof");
  for (const path of ["/mobile/v1/register", "/mobile/v1/contribution-capabilities", "/v1/models", "/mobile/v1/demo/x/session"])
    expect(eventDemoProxyCookie(path, header)).toBeUndefined();
  expect(eventDemoProxyCookie("/mobile/v1/demo/test-only-event/session", "mycellios-demo-local=guest.proof; private=hidden")).toBe("mycellios-demo-local=guest.proof");
  expect(eventDemoProxyCookie("/mobile/v1/demo/test-only-event/session", "__Secure-mycellios-demo=bad proof")).toBeUndefined();
});
it("forwards only the guest chat cookie on guest chat paths, and never across features", () => {
  const header = "better-auth.session_token=private; __Secure-mycellios-guest=session.proof; __Secure-mycellios-demo=guest.proof";
  expect(eventDemoProxyCookie("/mobile/v1/guest/chat", header)).toBe("__Secure-mycellios-guest=session.proof");
  expect(eventDemoProxyCookie("/mobile/v1/guest/config?x=1", "mycellios-guest-local=a.b; other=1")).toBe("mycellios-guest-local=a.b");
  expect(eventDemoProxyCookie("/mobile/v1/demo/test-only-event/session", header)).toBe("__Secure-mycellios-demo=guest.proof");
  for (const path of ["/mobile/v1/guestbook", "/mobile/v1/register", "/v1/chat/completions"])
    expect(eventDemoProxyCookie(path, header)).toBeUndefined();
});
