import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeScenario, scenarioNumber } from "./compute-scenario";
import { ComputeCalculator } from "./ComputeCalculator";
import { pricingEstimate } from "./pricing-estimate";

const compute = { gpuId: "4090", hours: "8", rateOverride: "" };
const pricing = { members: "2", inputMillions: "10", outputMillions: "2", inputRate: "0.15", outputRate: "0.6", hosting: "20", yearly: false };
describe("transparent GPU rental references", () => {
  it("shows exactly 30 days of selected GPU time at the published hourly rate", () => {
    expect(computeScenario(compute)).toEqual({ basis: "salad", monthlyHours: 240, hourlyRate: .16, monthlyValue: 38.4 });
    expect(computeScenario({ ...compute, hours: "24" })).toMatchObject({ monthlyHours: 720, monthlyValue: 115.2 });
    expect(computeScenario({ ...compute, hours: "0" })!.monthlyValue).toBe(0);
  });
  it("uses the GPU-specific reference and retains sub-cent hourly precision", () => {
    expect(computeScenario({ ...compute, gpuId: "5090" })!.monthlyValue).toBe(60);
    expect(computeScenario({ ...compute, gpuId: "5060" })).toMatchObject({ hourlyRate: .065, monthlyValue: 15.6 });
  });
  it("rejects unlisted GPUs instead of assigning a market-wide floor", () => {
    expect(computeScenario({ ...compute, gpuId: "custom" })).toBeNull();
    expect(computeScenario({ ...compute, gpuId: "custom", rateOverride: "0.5" })).toBeNull();
    expect(computeScenario({ ...compute, gpuId: "unknown" })).toBeNull();
  });
  it("distinguishes a custom rate, an explicit zero and the published reference", () => {
    expect(computeScenario({ ...compute, rateOverride: ".125" })).toMatchObject({ basis: "custom", monthlyValue: 30 });
    expect(computeScenario({ ...compute, rateOverride: "0" })).toMatchObject({ basis: "custom", monthlyValue: 0 });
    expect(computeScenario({ ...compute, rateOverride: " " })).toMatchObject({ basis: "salad", hourlyRate: .16 });
  });
  it.each(["-1", "Infinity", "NaN", "10001"])("does not turn invalid rate %s into a reference quote", rateOverride => {
    expect(computeScenario({ ...compute, rateOverride })).toMatchObject({ hourlyRate: null, monthlyValue: null, basis: "custom" });
  });
  it.each(["", "-1", "25", "Infinity"])("rejects unavailable or impossible daily hours %s", hours => {
    expect(computeScenario({ ...compute, hours })).toBeNull();
  });
  it("keeps ambiguous numeric formats out of both calculators", () => {
    expect(scenarioNumber("   ", 100)).toBeNull();
    expect(scenarioNumber("1,5", 100)).toBeNull();
  });
  it("presents a sourced rental reference separately from Mycellios payouts", () => {
    const html = renderToStaticMarkup(createElement(ComputeCalculator));
    expect(html).toContain("Monthly rental reference");
    expect(html).toContain("$38.40");
    expect(html).toContain('href="https://salad.com/pricing/"');
    expect(html).toContain("Checked 2026-11-01");
    expect(html).toContain("Mycellios contributor payouts: coming soon.");
    expect(html).not.toContain("Gross revenue");
  });
});
describe("provider cost estimates", () => {
  it("totals per-person tokens and a shared hosting bill", () => expect(pricingEstimate(pricing)).toEqual({ modelUsage: 5.4, hosting: 20, total: 25.4 }));
  it("uses twelve months without inventing an annual discount", () => expect(pricingEstimate({ ...pricing, yearly: true })).toEqual({ modelUsage: 64.8, hosting: 240, total: 304.8 }));
  it("reconciles the displayed cents instead of rounding an invisible total", () => expect(pricingEstimate({ ...pricing, members: "1", inputMillions: "1", outputMillions: "0", inputRate: "0.105", hosting: "0.105" })).toEqual({ modelUsage: .11, hosting: .11, total: .22 }));
  it("does not manufacture a free quote when a provider rate is missing", () => {
    expect(pricingEstimate({ ...pricing, inputRate: "" })).toBeNull();
    expect(pricingEstimate({ ...pricing, inputRate: "0", outputRate: "0", hosting: "0" })!.total).toBe(0);
  });
  it.each(["0", "1.5", "1001"])("rejects invalid member count %s", members => expect(pricingEstimate({ ...pricing, members })).toBeNull());
});
