import type { AdapterContext, ComputerRef } from "@mycellios/adapter-kit";
import { expect, it } from "vitest";
import { FakeBrowserProvider } from "./fake-browser.js";

const context: AdapterContext = {
  operationId: "1",
  traceId: "1",
  spaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};
const computer: ComputerRef = { id: "c1", botId: "b1", kind: "fake", providerRef: "c1" };

it("reads the part of the page a snapshot asks for", async () => {
  const browser = new FakeBrowserProvider({
    pages: {
      "https://example.test/": {
        title: "Example",
        html: "<!doctype html><html><head><title>Example</title></head><body><button>Go</button></body></html>",
      },
    },
  });
  await browser.navigate(computer, { url: "https://example.test/" }, context);
  expect((await browser.snapshot(computer, {}, context)).elements).toHaveLength(1);
  expect(await browser.snapshot(computer, { from: 2 }, context)).toMatchObject({
    elements: [],
    error: "This page has 1 part(s), numbered from 0, so there is no part 2.",
  });
});
