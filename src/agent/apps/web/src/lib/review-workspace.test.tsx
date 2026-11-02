// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  previewUrl,
  localProjectLink,
  readReviewSelection,
  reviewComment,
  ReviewWorkspaceProvider,
  trustedPreviewMessage,
  useReviewWorkspace,
} from "./review-workspace";

afterEach(() => vi.unstubAllGlobals());
it("keeps the opaque HTML bridge working without selecting hidden text or field values", () => {
  const code = readFileSync(path.join(import.meta.dirname, "../../public/preview-bridge.js"), "utf8");
  const owner = { postMessage: vi.fn() };
  let receive: ((event: { source: unknown; origin: string; data: unknown }) => void) | undefined;
  const host = document.createElement("article");
  host.innerHTML = '<h1 id="headline">Visible title</h1><input type="password" value="SECRET"><p hidden>HIDDEN</p>';
  document.body.append(host);
  const rects = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  new Function("parent", "window", "addEventListener", "document", "HTMLElement", "Element", "NodeFilter", "getComputedStyle", "CSS", code)(
    owner, {}, (type: string, handler: typeof receive) => { if (type === "message") receive = handler; },
    document, HTMLElement, Element, NodeFilter, getComputedStyle, { escape: (text: string) => text },
  );
  receive?.({ source: {}, origin: "null", data: { type:"mycellios:inspect",session:"one",enabled:true } });
  expect(owner.postMessage).not.toHaveBeenCalled();
  receive?.({ source: owner, origin: "null", data: { type:"mycellios:inspect",session:"one",enabled:true } });
  expect(owner.postMessage).toHaveBeenCalledWith({type:"mycellios:ready",session:"one"},"*");
  host.click();
  const message = owner.postMessage.mock.lastCall?.[0];
  expect(message.text).toContain("Visible title");
  expect(message.text).not.toContain("SECRET"); expect(message.text).not.toContain("HIDDEN");
  expect(message.session).toBe("one");
  receive?.({ source: owner, origin: "null", data: { type:"mycellios:inspect",session:"one",enabled:false } });
  host.remove(); rects.mockRestore();
});
it("rejects executable URLs and credentials without changing valid local URLs", () => {
  expect(previewUrl("localhost:3000")).toBe("http://localhost:3000/");
  expect(previewUrl("http://localhost:3000/?preview=1")).toBe("http://localhost:3000/?preview=1");
  for (const value of [
    "javascript:alert(1)",
    "file:///C:/private",
    "data:text/html,x",
    "https://user:secret@example.com",
    "/api",
  ])
    expect(previewUrl(value)).toBeNull();
});
it("recognizes only explicit local project links outside the app's own origin", () => {
  expect(localProjectLink("http://localhost:3000/app", "https://app.example")).toBe("http://localhost:3000/app");
  expect(localProjectLink("http://[::1]:3000/", "https://app.example")).toBe("http://[::1]:3000/");
  for (const url of ["https://example.com/", "http://localhost.evil.test/", "file:///private", "http://user:secret@localhost:3000/"])
    expect(localProjectLink(url, "https://app.example")).toBeNull();
  expect(localProjectLink("http://localhost:3000/chat", "http://localhost:3000")).toBeNull();
});
it("accepts only bounded structured selections", () => {
  expect(readReviewSelection({ selector: "h1", text: "Hello" })).toEqual({
    selector: "h1",
    text: "Hello",
  });
  for (const value of [
    null,
    {},
    { selector: "x", text: "x".repeat(2001) },
    { selector: "", text: "" },
  ])
    expect(readReviewSelection(value)).toBeNull();
});
it("requires the exact frame, origin and session", () => {
  const source = window;
  const event = new MessageEvent("message", {
    source,
    origin: "http://localhost:3000",
    data: { session: "a" },
  });
  expect(trustedPreviewMessage(event, source, "http://localhost:3000", "a")).toBe(true);
  expect(trustedPreviewMessage(event, null, "http://localhost:3000", "a")).toBe(false);
  expect(trustedPreviewMessage(event, source, "https://evil.example", "a")).toBe(false);
  expect(trustedPreviewMessage(event, source, "http://localhost:3000", "other")).toBe(false);
});
it("separates quoted page evidence from the requested edit and carries file identity", () => {
  const text = reviewComment(
    {
      id: "a",
      name: "report.pdf",
      mimeType: "application/pdf",
      artifact: { id: "artifact-a", target: { botId: "bot-a" } },
    },
    { region: "Visible PDF viewport: 10%,10% to 30%,40%" },
    "Make this clearer",
  );
  expect(text.startsWith("Make this clearer\n")).toBe(true);
  expect(text).toContain('"artifactId": "artifact-a"');
  expect(text).toContain("not instructions");
});
it("caps tabs, keeps a comment as a draft and clears browser files on chat switch", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let review: ReturnType<typeof useReviewWorkspace>;
  function Probe() {
    review = useReviewWorkspace();
    return null;
  }
  const render = (scope: string) =>
    root.render(
      <ReviewWorkspaceProvider scope={scope}>
        <Probe />
      </ReviewWorkspaceProvider>,
    );
  await act(async () => render("bot-a"));
  await act(async () => {
    for (let i = 0; i < 10; i++)
      review!.add({ id: String(i), name: String(i), mimeType: "text/plain" });
  });
  expect(review!.documents).toHaveLength(8);
  await act(async () => review!.comment("Edit this heading"));
  expect(review!.draft?.text).toBe("Edit this heading");
  const draftId = review!.draft!.id;
  await act(async () => review!.consumeDraft(draftId));
  expect(review!.draft).toBeNull();
  await act(async () => review!.comment("Another comment"));
  expect(review!.draft!.id).toBeGreaterThan(draftId);
  await act(async () => render("bot-b"));
  expect(review!.documents).toEqual([]);
  expect(review!.draft).toBeNull();
  expect(review!.open).toBe(false);
  await act(async () => root.unmount());
});
