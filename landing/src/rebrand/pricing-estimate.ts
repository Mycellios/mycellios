import { scenarioNumber } from "./compute-scenario";

export function pricingEstimate(input: { members: string; inputMillions: string; outputMillions: string; inputRate: string; outputRate: string; hosting: string; yearly: boolean }) {
  const members = scenarioNumber(input.members, 1000), inputMillions = scenarioNumber(input.inputMillions, 1000000), outputMillions = scenarioNumber(input.outputMillions, 1000000);
  const inputRate = scenarioNumber(input.inputRate, 10000), outputRate = scenarioNumber(input.outputRate, 10000), hosting = scenarioNumber(input.hosting, 1000000);
  if (members === null || members < 1 || !Number.isInteger(members) || inputMillions === null || outputMillions === null || inputRate === null || outputRate === null || hosting === null) return null;
  const modelUsage = (inputMillions * inputRate + outputMillions * outputRate) * members;
  const periods = input.yearly ? 12 : 1;
  const modelCents = Math.round(modelUsage * periods * 100), hostingCents = Math.round(hosting * periods * 100);
  return { modelUsage: modelCents / 100, hosting: hostingCents / 100, total: (modelCents + hostingCents) / 100 };
}
