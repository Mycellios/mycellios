import { describe, expect, it } from "vitest";
import { EncryptedSecretStore } from "./secrets.js";

describe("EncryptedSecretStore", () => {
  const context = { signal: new AbortController().signal } as never;

  it("seals and opens a secret, bound to its record id", async () => {
    const store = new EncryptedSecretStore("synthetic-test-key");
    const record = await store.put("synthetic-value", context, { recordId: "record-a" });
    expect(record.ciphertext.startsWith("v2:")).toBe(true);
    await expect(store.load(record.ciphertext, { recordId: "record-a" } as never)).resolves.toBe("synthetic-value");
    await expect(store.load(record.ciphertext, { recordId: "record-b" } as never)).rejects.toThrow();
  });

  it("derives the write key off the event loop, so a timer runs while a secret is sealed", async () => {
    const store = new EncryptedSecretStore("synthetic-test-key");
    const order: string[] = [];
    const sealed = store.put("synthetic-value", context).then(() => order.push("sealed"));
    setTimeout(() => order.push("timer"), 0);
    await sealed;
    expect(order).toEqual(["timer", "sealed"]);
  });
});
