import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
function store() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
const old = "20261103211604",
  current = "20261104080218";
it("records the first visit without claiming an update", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store();
  expect(observeRelease(current, s, null)?.show).toBe(false);
  expect(observeRelease(current, s, null)?.show).toBe(false);
});
it("shows a newer loaded build but not an ordinary reload", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store();
  observeRelease(old, s, null);
  expect(observeRelease(current, s, null)?.show).toBe(true);
  expect(observeRelease(current, s, null)?.show).toBe(false);
});
it("recognizes the preexisting guarded update marker on the first upgraded load", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store(),
    session = store();
  session.setItem("rk:client-update-attempt", JSON.stringify({ from: old, to: current }));
  expect(observeRelease(current, s, session)).toEqual({ previousBuild: old, show: true });
});
it.each([
  "broken",
  '{"from":"fake","to":"20261102090000"}',
  '{"from":"20261101164621","to":"20990101000000"}',
])("rejects a malformed or not-yet-loaded update (%s)", async (marker) => {
  const { observeRelease } = await import("./release-notes");
  const session = store();
  session.setItem("rk:client-update-attempt", marker);
  expect(observeRelease(current, store(), session)?.show).toBe(false);
});
it("does not advertise unreleased notes or treat a rollback as a new version", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store();
  observeRelease("20261001000000", s, null);
  expect(observeRelease(old, s, null)?.show).toBe(false);
  observeRelease(current, s, null);
  expect(observeRelease(old, s, null)?.show).toBe(false);
  expect(observeRelease(current, s, null)?.show).toBe(false);
});
it("acknowledges one notes edition without resetting it for hotfix builds", async () => {
  const { observeRelease, acknowledgeRelease } = await import("./release-notes");
  const s = store();
  observeRelease(old, s, null);
  expect(observeRelease(current, s, null)?.show).toBe(true);
  acknowledgeRelease(s);
  expect(observeRelease("20261105000000", s, null)?.show).toBe(false);
});
it("handles development and denied storage without breaking startup", async () => {
  const { observeRelease } = await import("./release-notes");
  const denied = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
  };
  expect(observeRelease("", denied, null)).toBeNull();
  expect(() => observeRelease(current, denied, denied)).not.toThrow();
});
