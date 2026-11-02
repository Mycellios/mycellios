import { describe, expect, it, vi } from "vitest";
import { createModelProbe, initialModelProbeState } from "./model-probe.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  const onChange = vi.fn();
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const controller = createModelProbe(onChange);
  const input = {
    baseUrl: " https://models.example.test/v1 ",
    apiKey: " fake-key ",
    onSuccess,
    onError,
  };
  return { controller, input, onChange, onSuccess, onError };
}

describe("model probe lifecycle", () => {
  it("recovers one timed-out catalog lookup without clearing the loading state", async () => {
    const { controller, input, onChange, onSuccess, onError } = setup();
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("Model server probe timed out"))
      .mockResolvedValueOnce({ models: ["recovered-model"] });
    await controller.probe({ ...input, request });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(["recovered-model"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([
    ["Model server probe timed out", 2],
    ["Model server returned 401", 1],
    ["Model server returned 403", 1],
  ])("bounds retries for %s", async (message, attempts) => {
    const { controller, input, onError } = setup();
    const error = new Error(message);
    const request = vi.fn().mockRejectedValue(error);
    await controller.probe({ ...input, request });
    expect(request).toHaveBeenCalledTimes(attempts);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("does not retry a timeout from an obsolete connection", async () => {
    const { controller, input, onError } = setup();
    const pending = deferred<{ models: string[] }>();
    const request = vi.fn(() => pending.promise);
    const probe = controller.probe({ ...input, request });
    controller.reset();
    pending.reject(new Error("probe timed out"));
    await probe;
    expect(request).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("normalizes the connection and treats an empty catalog as a successful manual-entry probe", async () => {
    const { controller, input, onChange, onSuccess } = setup();
    const request = vi.fn().mockResolvedValue({ models: [] });
    await controller.probe({ ...input, request });
    expect(request).toHaveBeenCalledWith({
      baseUrl: "https://models.example.test/v1",
      apiKey: "fake-key",
    });
    expect(onChange.mock.calls).toEqual([
      [{ models: [], baseUrl: null, probing: true }],
      [{ models: [], baseUrl: "https://models.example.test/v1", probing: false }],
    ]);
    expect(onSuccess).toHaveBeenCalledWith([]);
  });

  it.each(["provider", "key", "URL"])("ignores a result after the %s changes", async () => {
    const { controller, input, onChange, onSuccess, onError } = setup();
    const pending = deferred<{ models: string[] }>();
    const probe = controller.probe({ ...input, request: () => pending.promise });
    controller.reset();
    pending.resolve({ models: ["old-model"] });
    await probe;
    expect(onChange).toHaveBeenLastCalledWith(initialModelProbeState);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not report errors or update state after unmount", async () => {
    const { controller, input, onChange, onError } = setup();
    const pending = deferred<{ models: string[] }>();
    const probe = controller.probe({ ...input, request: () => pending.promise });
    controller.invalidate();
    pending.reject(new Error("old failure"));
    await probe;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not let an older request finish a newer request", async () => {
    const { controller, input, onChange, onSuccess } = setup();
    const old = deferred<{ models: string[] }>();
    const current = deferred<{ models: string[] }>();
    const first = controller.probe({ ...input, request: () => old.promise });
    const second = controller.probe({ ...input, request: () => current.promise });
    old.resolve({ models: ["old-model"] });
    await first;
    expect(onChange).toHaveBeenLastCalledWith({ models: [], baseUrl: null, probing: true });
    expect(onSuccess).not.toHaveBeenCalled();
    current.resolve({ models: ["current-model"] });
    await second;
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(["current-model"]);
  });

  it("clears probing after failure and omits a blank key", async () => {
    const { controller, input, onChange, onError } = setup();
    const error = new Error("unreachable");
    const request = vi.fn().mockRejectedValue(error);
    await controller.probe({ ...input, apiKey: "  ", request });
    expect(request).toHaveBeenCalledWith({
      baseUrl: "https://models.example.test/v1",
      apiKey: undefined,
    });
    expect(onChange).toHaveBeenLastCalledWith(initialModelProbeState);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
