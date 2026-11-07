export const INTERFACE_SIZES = ["67", "75", "80", "90", "100", "110", "125", "150", "175", "200"] as const;
export type InterfaceSize = (typeof INTERFACE_SIZES)[number];

const storageKey = "rakazo.interfaceSize";
let current: InterfaceSize | undefined;

export function getInterfaceSize(): InterfaceSize {
  if (current) return current;
  try {
    return INTERFACE_SIZES.find((size) => size === localStorage.getItem(storageKey)) ?? "100";
  } catch {
    return "100";
  }
}

export function applyInterfaceSize(size = getInterfaceSize()): void {
  document.documentElement.style.setProperty("zoom", size === "100" ? "" : `${size}%`);
}

export function setInterfaceSize(size: InterfaceSize): void {
  current = size;
  applyInterfaceSize(size);
  try {
    localStorage.setItem(storageKey, size);
  } catch {
    // The selected size still applies until this session ends.
  }
}
