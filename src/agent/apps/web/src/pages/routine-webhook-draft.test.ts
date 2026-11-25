import { describe, expect, it, vi } from "vitest";
import {
  filterDraftsFromWebhook,
  filterValueText,
  parseFilterValue,
  webhookSettingsFromDraft,
} from "./routine-webhook-draft";

vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
}));

describe("filter values", () => {
  it("reads JSON values and keeps other text as a string", () => {
    expect(parseFilterValue("42")).toBe(42);
    expect(parseFilterValue("true")).toBe(true);
    expect(parseFilterValue("null")).toBeNull();
    expect(parseFilterValue('"42"')).toBe("42");
    expect(parseFilterValue(" paid ")).toBe("paid");
    expect(parseFilterValue("{\"a\":1}")).toBe('{"a":1}');
  });

  it("writes each value so that it reads back with the same JSON type", () => {
    for (const value of ["paid", "42", "true", "null", 42, true, null, ""]) {
      expect(parseFilterValue(filterValueText(value))).toEqual(value);
    }
    expect(filterValueText("42")).toBe('"42"');
    expect(filterValueText("paid")).toBe("paid");
  });

  it("edits a saved routine's filters as text", () => {
    expect(
      filterDraftsFromWebhook({
        filters: [
          { pointer: "/amount", value: 42 },
          { pointer: "/code", value: "42" },
        ],
      }),
    ).toEqual([
      { pointer: "/amount", value: "42" },
      { pointer: "/code", value: '"42"' },
    ]);
  });
});

describe("webhookSettingsFromDraft", () => {
  it("sends the event type and filters as the api takes them", () => {
    expect(
      webhookSettingsFromDraft({
        webhookEventType: " invoice.paid ",
        webhookFilters: [
          { pointer: "status", value: "paid" },
          { pointer: "/amount", value: "42" },
          { pointer: " ", value: " " },
        ],
      }),
    ).toEqual({
      webhookEventType: "invoice.paid",
      webhookFilters: [
        { pointer: "/status", value: "paid" },
        { pointer: "/amount", value: 42 },
      ],
    });
    expect(webhookSettingsFromDraft({})).toEqual({ webhookEventType: null, webhookFilters: [] });
  });

  it("explains what cannot be saved", () => {
    expect(webhookSettingsFromDraft({ webhookEventType: "invoice paid" })).toHaveProperty("error");
    expect(
      webhookSettingsFromDraft({ webhookFilters: [{ pointer: "/bad~2", value: "x" }] }),
    ).toHaveProperty("error");
    expect(
      webhookSettingsFromDraft({
        webhookFilters: Array.from({ length: 33 }, (_, index) => ({ pointer: `/f${index}`, value: "1" })),
      }),
    ).toHaveProperty("error");
  });
});
