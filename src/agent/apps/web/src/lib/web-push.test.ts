import { describe, expect, it, vi } from "vitest";
import { pushEnrollmentAction } from "./web-push";

vi.mock("./rpc", () => ({ rpc: {} }));

const ready = { publicKey: "key", enabled: true, permission: "granted", registered: false, bound: false } as const;

describe("notification permission and enrollment", () => {
  it("enrolls without a second opt-in after the system permission is granted", () => {
    expect(pushEnrollmentAction(ready)).toBe("register");
    expect(pushEnrollmentAction({ ...ready, registered: true })).toBe("register");
    expect(pushEnrollmentAction({ ...ready, registered: true, bound: true })).toBeNull();
  });
  it("does not enroll when permission has not been given or the user disabled notifications", () => {
    expect(pushEnrollmentAction({ ...ready, permission: "default" })).toBeNull();
    expect(pushEnrollmentAction({ ...ready, enabled: false })).toBeNull();
    expect(pushEnrollmentAction({ ...ready, publicKey: null })).toBeNull();
  });
  it("removes existing enrollment when permission is reset or the user turns notifications off", () => {
    expect(pushEnrollmentAction({ ...ready, registered: true, permission: "default" })).toBe("remove");
    expect(pushEnrollmentAction({ ...ready, bound: true, enabled: false })).toBe("remove");
  });
});
