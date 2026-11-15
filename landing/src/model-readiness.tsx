import type { RequestedModelCapacity } from "../../src/contracts/dashboard";
import { Text } from "./ui/primitives";
import { formatMemory } from "./panel-ui-utilities";

/** Presentation of the coordinator's decision. This never admits or starts work. */
export function modelReadiness(model: RequestedModelCapacity): { title: string; nextStep: string } {
  if (model.status === "active") {
    return { title: "Available for inference", nextStep: "Choose this model in your application." };
  }
  if (model.activationIncident) {
    const incident = model.activationIncident;
    return { title: incident.title, nextStep: incident.remedy };
  }
  if (model.status === "profiling") {
    return { title: "Checking model requirements", nextStep: "Wait while Mycellios reads the model metadata." };
  }
  if (model.status === "waiting_capacity") {
    const missing: string[] = [];
    if (model.missingNodes > 0) missing.push(`${model.missingNodes} more ${model.missingNodes === 1 ? "compatible node" : "compatible nodes"}`);
    if (model.missingVramMiB !== null && model.missingVramMiB > 0) missing.push(`${formatMemory(model.missingVramMiB)} more GPU memory`);
    return {
      title: missing.length > 0 ? `Needs ${missing.join(" and ")}` : "Waiting for compatible capacity",
      nextStep: "Connect compatible equipment or release its reserved capacity. Mycellios checks availability again automatically.",
    };
  }
  if (model.status === "activating") {
    return { title: "Preparing the model", nextStep: "Mycellios is checking placement, connections and the runtime before making the model available." };
  }
  if (model.status === "ready") {
    return {
      title: "Capacity requirements reached",
      nextStep: model.autoActivate ? "Configure the network deployment service to activate this model." : "Automatic activation is off. Ask the network administrator to activate this model.",
    };
  }
  if (model.status === "incompatible") {
    return { title: "This model needs a compatible runtime", nextStep: "Choose a model supported by the installed runtime. Open diagnostics for the compatibility details." };
  }
  return { title: "Model preparation needs attention", nextStep: "Open diagnostics to inspect the recorded failure before starting another activation." };
}

export function ModelReadiness({ model }: { model: RequestedModelCapacity }) {
  const diagnosis = modelReadiness(model);
  return <div className="model-readiness" aria-label={`Readiness of ${model.id}`}>
    <Text><strong>{diagnosis.title}</strong></Text>
    <Text>{diagnosis.nextStep}</Text>
  </div>;
}

export function friendlyActivationFailure(message: string): string {
  const exhausted = /automatic_activation_retries_exhausted:(\d+):/i.exec(message);
  if (exhausted && message.includes("distributed_activation_requires_two_connected_shard_executors")) {
    return `Automatic activation paused after ${exhausted[1]} attempts because the two-PC execution route was still not verified. Keep both PCs online, then run activation again.`;
  }
  if (message.includes("distributed_activation_requires_two_connected_shard_executors")) {
    return "Two verified shard executors are not ready yet. The model remains unpublished while Mycellios rebuilds the route.";
  }
  if (exhausted) {
    return "Automatic activation stopped after repeated temporary node disconnections. The model was not published.";
  }
  if (message.includes("3221225477")) {
    return "A Windows accelerator process crashed while loading the model stage. Capacity was available, but the runtime could not complete the load.";
  }
  return message.includes("launch_process_exited:") ? "A model stage stopped during activation. Open capacity and diagnostics for the reported cause." : message.replace(/^Automatic activation failed:\s*/i, "") || "The model runtime stopped before activation completed.";
}

