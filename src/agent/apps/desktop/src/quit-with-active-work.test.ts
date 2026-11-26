import { expect, it, vi } from "vitest";
import { createDesktopQuitGuard } from "./quit-with-active-work.js";

it("allows an idle Desktop to quit without prompting", () => {
  const confirm = vi.fn();
  const quit = vi.fn();
  const deferQuit = createDesktopQuitGuard({ busy: () => false, confirm, quit });

  expect(deferQuit()).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  expect(quit).not.toHaveBeenCalled();
});

it("holds repeated close requests during work and quits only after confirmation", async () => {
  const confirm = vi.fn<() => Promise<boolean>>();
  const quit = vi.fn();
  const deferQuit = createDesktopQuitGuard({ busy: () => true, confirm, quit });

  confirm.mockResolvedValueOnce(false);
  expect(deferQuit()).toBe(true);
  expect(deferQuit()).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(quit).not.toHaveBeenCalled();

  confirm.mockResolvedValueOnce(true);
  expect(deferQuit()).toBe(true);
  expect(quit).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
});

it("keeps Desktop running when the confirmation cannot open", async () => {
  const quit = vi.fn();
  const deferQuit = createDesktopQuitGuard({
    busy: () => true,
    confirm: async () => { throw new Error("Prompt unavailable"); },
    quit,
  });

  expect(deferQuit()).toBe(true);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(quit).not.toHaveBeenCalled();
});
