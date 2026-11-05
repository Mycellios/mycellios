import { useId, useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Disclosure, DisclosureSummary, Field, Heading, Input, Link, Select, Text } from "../ui/primitives";
import { GPU_PRESETS, GPU_RENTAL_REFERENCE, computeScenario, scenarioNumber } from "./compute-scenario";
import "./compute-calculator.css";

export function ComputeCalculator() {
  const id = useId();
  const [gpu, setGpu] = useState("4090");
  const [hours, setHours] = useState("8");
  const [rateOverride, setRateOverride] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const preset = GPU_PRESETS.find(item => item.id === gpu) ?? GPU_PRESETS[1];
  const result = computeScenario({ gpuId: preset.id, hours, rateOverride });
  const custom = result?.basis === "custom";
  const invalidRate = rateOverride.trim() !== "" && scenarioNumber(rateOverride, 10000) === null;
  const money = (value: number | null | undefined, hourly = false) => value == null ? "—" : new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: hourly ? 3 : 2, maximumFractionDigits: hourly ? 6 : 2,
  }).format(value);

  return <div className="compute-calculator" data-ui="compute-scenario">
    <div className="compute-calculator-controls">
      <Heading as="h3">Your GPU time, in numbers.</Heading>
      <Text>Choose your GPU and the hours you could share each day.</Text>
      <div className="compute-basic-fields">
        <Field label="GPU model" htmlFor={id + "-gpu"}>
          <Select id={id + "-gpu"} value={preset.id} onChange={event => {
            setGpu(event.target.value);
            setRateOverride("");
            setDetailsOpen(false);
          }}>
            {GPU_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.vramGb} GB</option>)}
          </Select>
        </Field>
        <Field label="Hours to share / day" htmlFor={id + "-hours"}>
          <Select id={id + "-hours"} value={hours} onChange={event => setHours(event.target.value)}>
            {Array.from({ length: 25 }, (_, value) => <option key={value} value={value}>{value} {value === 1 ? "hour" : "hours"} / day</option>)}
          </Select>
        </Field>
      </div>
      <Text as="small" className="compute-rate-source">
        {custom ? "Your hourly rate: " : "Indicative hourly rate: "}{money(result?.hourlyRate, true)} / GPU-hour
      </Text>
      <Disclosure className="compute-method ui-animated-disclosure" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
        <DisclosureSummary>How is this calculated?<ChevronDown size={16} /></DisclosureSummary>
        <div className="ui-disclosure-body">
        <Text>Daily hours × 30 days × the hourly rate. Every selected hour is assumed to be rented. Electricity, fees and taxes are excluded.</Text>
        <Text as="small">Published rental rate ({GPU_RENTAL_REFERENCE.tier} priority): {money(preset.referenceRate, true)} per GPU-hour. Checked {GPU_RENTAL_REFERENCE.checkedAt}. Availability can change. <Link href={GPU_RENTAL_REFERENCE.source} target="_blank" rel="noreferrer">View rate source<ArrowUpRight size={12} /></Link></Text>
        <Field label="Hourly rate (USD)" htmlFor={id + "-rate"} hint="Optional. Leave empty to use the published reference." {...(invalidRate ? { error: "Enter a rate between 0 and 10000 USD." } : {})}>
          <Input id={id + "-rate"} type="number" inputMode="decimal" min="0" max="10000" step="any" value={rateOverride} placeholder={String(preset.referenceRate)} aria-invalid={invalidRate} aria-describedby={id + "-rate-hint" + (invalidRate ? " " + id + "-rate-error" : "")} onChange={event => setRateOverride(event.target.value)} />
        </Field>
        </div>
      </Disclosure>
      <Link className="compute-connect" href="/earn#earn-options" variant="primary">Connect your compute<ArrowUpRight size={15} /></Link>
    </div>
    <div className="compute-calculator-result" aria-live="polite" aria-atomic="true">
      <Text>{custom ? "Your gross scenario" : "Monthly rental reference"}</Text>
      <strong>{money(result?.monthlyValue)}</strong>
      <Text>USD / 30-day month</Text>
      {result?.hourlyRate != null ? <Text className="compute-formula">{hours} h/day × {GPU_RENTAL_REFERENCE.days} days × {money(result.hourlyRate, true)}/h</Text> : <Text className="compute-formula">Enter an hourly rate to see the calculation.</Text>}
      <Text as="small">Assumes all {result?.monthlyHours ?? "—"} selected GPU-hours are rented.</Text>
      <Text as="small" className="compute-reward-status">{custom ? "Your entered rate, before costs. " : "The market cost of renting this compute. "}Mycellios contributor payouts: coming soon.</Text>
    </div>
  </div>;
}
