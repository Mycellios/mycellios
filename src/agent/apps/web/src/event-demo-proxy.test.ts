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
