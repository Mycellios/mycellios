import type { ImageAspectRatio } from "@rakazo/contracts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_SIDE = 65_535;

/** Pixel size from a PNG's IHDR header, or null when the bytes are not a readable PNG. */
export function pngPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value))
    return null;
  const header = String.fromCharCode(...bytes.subarray(12, 16));
  if (header !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return null;
  return { width, height };
}

/** Near-square pictures count as square, so a few pixels of padding do not flip the shape. */
export function imageAspectRatioOf(size: { width: number; height: number }): ImageAspectRatio {
  const ratio = size.width / size.height;
  if (ratio > 1.05) return "landscape";
  if (ratio < 1 / 1.05) return "portrait";
  return "square";
}
