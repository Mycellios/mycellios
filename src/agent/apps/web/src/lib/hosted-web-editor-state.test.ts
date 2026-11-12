import type { HostedWebDraft } from "@rakazo/contracts";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./rpc", () => {
  const client = (): unknown => new Proxy(() => undefined, { get: () => client() });
  return {
    rpc: client(),
    createSpaceRpc: client,
    rpcForSpace: client,
    selectedSpaceId: () => null,
  };
});

import { composerHoldsUnsavedWork } from "./composer-draft";
import { clearWebEditor, readWebEditor, writeWebEditor, readAppPrompt, writeAppPrompt } from "./hosted-web-editor-state";
import { queryClient, setQueryUser } from "./query";

afterEach(() => queryClient.clear());
it("preserves an app prompt and uncertain send receipt until account cache clearing", () => {
  setQueryUser("prompt-owner");
  writeAppPrompt("owner:space:thread", { text: "Build my app", nonce: "uncertain-send" });
  expect(readAppPrompt("owner:space:thread")).toEqual({ text: "Build my app", nonce: "uncertain-send" });
  expect(readAppPrompt("other:space:thread")).toBeUndefined();
  expect(composerHoldsUnsavedWork()).toBe(true);
  setQueryUser("other-owner");
  expect(readAppPrompt("owner:space:thread")).toBeUndefined();
  expect(composerHoldsUnsavedWork()).toBe(false);
});
const draft: HostedWebDraft = {
  id: "draft",
  version: 2,
  title: "Unsaved work",
  slug: "my-website",
  summary: "",
  bundle: { files: [{ path: "index.html", base64: "aGk=" }] },
  published: false,
};
it("retains exact unsaved source/selection when the editor unmounts, isolated by account and Space", () => {
  const scope = JSON.stringify(["user-a", "space-a"]);
  writeWebEditor(scope, { draft, dirty: true, selected: "index.html", busy: false });
  expect(readWebEditor(scope)).toMatchObject({ draft, dirty: true, selected: "index.html" });
  expect(readWebEditor(JSON.stringify(["user-a", "space-b"]))).toBeUndefined();
  expect(readWebEditor(JSON.stringify(["user-b", "space-a"]))).toBeUndefined();
  expect(composerHoldsUnsavedWork()).toBe(true);
  clearWebEditor(scope);
  expect(readWebEditor(scope)).toBeUndefined();
  expect(composerHoldsUnsavedWork()).toBe(false);
});
it("does not let one saved editor release another editor's reload guard", () => {
  writeWebEditor("one", { draft, dirty: true, selected: "index.html", busy: false });
  writeWebEditor("two", { draft, dirty: false, selected: "index.html", busy: false });
  expect(composerHoldsUnsavedWork()).toBe(true);
  clearWebEditor("one");
  expect(composerHoldsUnsavedWork()).toBe(false);
});
it("clears private cached source and reload holds on account switch/sign-out", () => {
  setQueryUser("user-a");
  writeWebEditor("private", { draft, dirty: true, selected: "index.html", busy: true });
  setQueryUser("user-b");
  expect(readWebEditor("private")).toBeUndefined();
  expect(composerHoldsUnsavedWork()).toBe(false);
});
