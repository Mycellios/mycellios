import type { TaskCost } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TaskCostFooter } from "./task-cost-footer";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    i18n: { locale: "en-US" },
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));
const cost: TaskCost = {
  runId: "fixture",
  state: "confirmed",
  amountUsd: 0,
  modelCalls: 2,
  unpricedCalls: 0,
};
const render = (value: TaskCost) => renderToStaticMarkup(<TaskCostFooter cost={value} />);
it("shows actual zero and small nonzero amounts distinctly", () => {
  expect(render(cost)).toContain("AI cost");
  expect(render(cost)).toContain("$0.00");
  expect(render({ ...cost, amountUsd: 0.000123 })).toContain("$0.000123");
  expect(render({ ...cost, amountUsd: 1e-8 })).toContain("&lt;$0.000001");
});
it("does not display an unavailable or pending amount as free", () => {
  expect(render({ ...cost, state: "unavailable", amountUsd: null })).toContain(
    "AI cost unavailable",
  );
  expect(render({ ...cost, state: "pending", amountUsd: null })).not.toContain("$0.00");
  expect(render({ ...cost, state: "estimated", amountUsd: 0.0123 })).toContain("Estimated AI cost");
});
