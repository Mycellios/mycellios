import { expect, it } from "vitest";

it("loads real lazy translation catalogs in the test module graph", async () => {
  const { messages } = await import("../locales/es/messages.po");
  expect(Object.keys(messages).length).toBeGreaterThan(0);
  expect(Object.values(messages)).toContainEqual(["Programación"]);
});
