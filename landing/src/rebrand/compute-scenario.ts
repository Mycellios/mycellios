export const GPU_RENTAL_REFERENCE = {
  source: "https://salad.com/pricing/",
  checkedAt: "2026-11-01",
  tier: "Lowest",
  days: 30,
} as const;

/** Published rental prices in USD per GPU-hour, not contributor remuneration. */
export const GPU_PRESETS = [
  { id: "5090", label: "NVIDIA RTX 5090", vramGb: 32, referenceRate: .25 },
  { id: "4090", label: "NVIDIA RTX 4090", vramGb: 24, referenceRate: .16 },
  { id: "5080", label: "NVIDIA RTX 5080", vramGb: 16, referenceRate: .15 },
  { id: "5070-ti", label: "NVIDIA RTX 5070 Ti", vramGb: 16, referenceRate: .10 },
  { id: "4080", label: "NVIDIA RTX 4080", vramGb: 16, referenceRate: .11 },
  { id: "4070-ti-super", label: "NVIDIA RTX 4070 Ti Super", vramGb: 16, referenceRate: .09 },
  { id: "5090-laptop", label: "NVIDIA RTX 5090 Laptop", vramGb: 24, referenceRate: .10 },
  { id: "3090-ti", label: "NVIDIA RTX 3090 Ti", vramGb: 24, referenceRate: .10 },
  { id: "3090", label: "NVIDIA RTX 3090", vramGb: 24, referenceRate: .09 },
  { id: "5070", label: "NVIDIA RTX 5070", vramGb: 12, referenceRate: .08 },
  { id: "4070-ti", label: "NVIDIA RTX 4070 Ti", vramGb: 12, referenceRate: .08 },
  { id: "3080-ti", label: "NVIDIA RTX 3080 Ti", vramGb: 12, referenceRate: .08 },
  { id: "4070", label: "NVIDIA RTX 4070", vramGb: 12, referenceRate: .07 },
  { id: "5060-ti", label: "NVIDIA RTX 5060 Ti", vramGb: 16, referenceRate: .07 },
  { id: "3080", label: "NVIDIA RTX 3080", vramGb: 10, referenceRate: .06 },
  { id: "4060-ti", label: "NVIDIA RTX 4060 Ti", vramGb: 16, referenceRate: .08 },
  { id: "5060", label: "NVIDIA RTX 5060", vramGb: 8, referenceRate: .065 },
] as const;

export function scenarioNumber(value: string, maximum: number): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : null;
}

/** A fully rented 30-day reference, with no inferred demand or GPU performance. */
export function computeScenario(input: { gpuId: string; hours: string; rateOverride: string }) {
  const gpu = GPU_PRESETS.find(item => item.id === input.gpuId);
  const hours = scenarioNumber(input.hours, 24);
  if (!gpu || hours === null) return null;
  const custom = input.rateOverride.trim() !== "";
  const hourlyRate = custom ? scenarioNumber(input.rateOverride, 10000) : gpu.referenceRate;
  const monthlyHours = hours * GPU_RENTAL_REFERENCE.days;
  return {
    basis: custom ? "custom" as const : "salad" as const,
    monthlyHours,
    hourlyRate,
    monthlyValue: hourlyRate === null ? null : Math.round((monthlyHours * hourlyRate + Number.EPSILON) * 100) / 100,
  };
}
