import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }) }));
import { RosterMessagePreviewContent } from "./RosterMessagePreview";
it("shows the actual waiting state, message and reply hint", () => {
  const html = renderToStaticMarkup(<RosterMessagePreviewContent name="Mico" status="waiting_input" preview="  What do you need?  " />);
  expect(html).toContain("Waiting for your response"); expect(html).toContain("What do you need?"); expect(html).toContain("Select to reply");
  expect(html).toContain("text-warning"); expect(html).toContain("line-clamp-6");
});
it("does not describe an idle conversation as waiting for input", () => {
  const html = renderToStaticMarkup(<RosterMessagePreviewContent name="Mico" status="idle" preview="Done." />);
  expect(html).toContain("Ready"); expect(html).not.toContain("Select to reply"); expect(html).not.toContain("Waiting for your response");
});
it("keeps errors and computer takeover distinct from an ordinary reply", () => {
  expect(renderToStaticMarkup(<RosterMessagePreviewContent name="Mico" status="idle" hasError preview="Last message" />)).toContain("text-destructive");
  const takeover = renderToStaticMarkup(<RosterMessagePreviewContent name="Mico" status="waiting_takeover" mini />);
  expect(takeover).toContain("Mico"); expect(takeover).toContain("Select to see execution"); expect(takeover).not.toContain("Select to reply");
});
