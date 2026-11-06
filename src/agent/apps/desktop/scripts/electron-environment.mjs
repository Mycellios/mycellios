// Electron checks the presence of ELECTRON_RUN_AS_NODE, even when it is empty.
export function electronGuiEnvironment(environment=process.env) {
  const result={...environment};
  delete result.ELECTRON_RUN_AS_NODE;
  delete result.NODE_OPTIONS;
  return result;
}
