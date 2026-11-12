import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RosterReplyIndicator } from "./RosterReplyIndicator";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }) }));
it("shows the answer label only while a reply is required", () => {
  const html = renderToStaticMarkup(<RosterReplyIndicator status="waiting_input" />);
  expect(html).toContain("data-roster-answer"); expect(html).toContain("Answer");
  expect(html).not.toContain("<button");
});
it.each(["running", "queued", "idle", "failed", "waiting_takeover"])("does not advertise a question for %s", status => {
  expect(renderToStaticMarkup(<RosterReplyIndicator status={status} />)).toBe("");
});
it("keeps a labeled question marker visible in the collapsed avatar rail", () => {
  const html = renderToStaticMarkup(<RosterReplyIndicator status="waiting_input" avatar />);
  expect(html).toContain("data-roster-question"); expect(html).toContain('aria-label="Needs an answer"');
});
