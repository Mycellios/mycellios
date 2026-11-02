export function shouldApplyBrowserUpdate(input: {
  currentSourceId: string; deployedSourceId: unknown; visible: boolean; busy: boolean;
}): boolean {
  return input.visible && !input.busy && typeof input.deployedSourceId === "string"
    && /^sha256:[0-9a-f]{64}$/.test(input.deployedSourceId)
    && input.deployedSourceId !== input.currentSourceId;
}
