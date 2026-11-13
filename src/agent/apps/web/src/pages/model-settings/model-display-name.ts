/** Display aliases only; persisted provider/model IDs remain unchanged. */
export function modelDisplayName(id: string, label?: string | null): string {
  if (label && label !== id) return label;
  if (id === "mycellios/managed/antseed/deepseek-v4-flash") return "DeepSeek V4 Flash";
  if (id === "agent-credit-lab-qwen3-1.7b") return "Qwen3 1.7B (lab)";
  return label || id;
}
