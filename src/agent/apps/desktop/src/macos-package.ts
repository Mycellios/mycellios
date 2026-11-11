/** The macOS package this installation owns. */
export type MacosPackageKind = "macos-arm64" | "macos-x64";

/**
 * A disk image has no package database to query, so the running architecture
 * decides. Intel Macs take the x64 image and Apple Silicon the arm64 one.
 */
export function macosPackageKind(arch: string): MacosPackageKind | null {
  if (arch === "arm64") return "macos-arm64";
  if (arch === "x64") return "macos-x64";
  return null;
}
