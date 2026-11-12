import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expertReference } from "../src/coordinator/browser-expert-reference.js";
import { readBrowserInferenceConfig } from "../src/core/browser-inference-config.js";
describe("bounded independent browser inference verification", () => {
  const weights = Buffer.from(new Float32Array([0.75, 0.5, 1.25]).buffer);
  const hash = createHash("sha256").update(weights).digest("hex");
  it("evaluates SwiGLU independently for multiple real activation rows", () => {
    const inputs = new Float32Array([-2, 0, 0.25, 2]);
    const result = expertReference(weights, hash, inputs, 4, 1, 1);
    for (const [index, x] of inputs.entries()) expect(result[index]).toBeCloseTo((0.75*x/(1+Math.exp(-0.75*x)))*0.5*x*1.25, 6);
  });
  it("rejects altered weights, oversized work, nonfinite values and mismatched shapes", () => {
    expect(() => expertReference(weights, "0".repeat(64), new Float32Array([1]), 1, 1, 1)).toThrow();
    expect(() => expertReference(weights, hash, new Float32Array([NaN]), 1, 1, 1)).toThrow();
    expect(() => expertReference(weights, hash, new Float32Array([1]), 1, 2, 1)).toThrow();
    expect(() => expertReference(weights, hash, new Float32Array([1]), 64, 16384, 65536)).toThrow();
  });
  it("requires explicit paid admission and an operator-pinned price/artifact", () => {
    expect(readBrowserInferenceConfig({})).toBeUndefined();
    expect(() => readBrowserInferenceConfig({ MYCELLIOS_BROWSER_INFERENCE_ENABLED: "true" })).toThrow();
    const config = { offers: [{model:"mycellios-browser/expert",artifactId:"a".repeat(64),costMicrounitsPerRow:1,maxRows:8}],dailyLimitMicrounits:1000 };
    expect(readBrowserInferenceConfig({MYCELLIOS_BROWSER_INFERENCE_ENABLED:"true",MYCELLIOS_BROWSER_INFERENCE_CONFIG:JSON.stringify(config)})).toEqual(config);
  });
});
