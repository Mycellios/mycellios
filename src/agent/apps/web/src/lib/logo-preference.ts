import { productBrand } from "@rakazo/contracts";
import { appPath } from "./app-path";
import { desktopBridge } from "./desktop";
import { getGeneralPreferences } from "./general-preferences";
let generation = 0;
export async function syncNativeLogo() {
  const update = desktopBridge()?.settings?.logo;
  const own = ++generation;
  const color = getGeneralPreferences().logoColor;
  if (color === "default") {
    document.documentElement.style.removeProperty("--custom-logo-image");
    delete document.documentElement.dataset.customLogoReady;
    await update?.(null); return;
  }
  const image = new Image();
  image.src = appPath(productBrand.markPath);
  await image.decode();
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext("2d"); if (!context) return;
  context.drawImage(image, 0, 0, 128, 128);
  const pixels = context.getImageData(0, 0, 128, 128);
  const rgb = color.slice(1).match(/../g)!.map(v => parseInt(v, 16));
  for (let i = 0; i < pixels.data.length; i += 4) {
    const brightness = Math.min(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!) / 255;
    pixels.data[i + 3] = Math.round(pixels.data[i + 3]! * (1 - brightness));
    pixels.data[i] = rgb[0]!; pixels.data[i + 1] = rgb[1]!; pixels.data[i + 2] = rgb[2]!;
  }
  context.putImageData(pixels, 0, 0);
  if (own === generation) {
    const png = canvas.toDataURL("image/png");
    document.documentElement.style.setProperty("--custom-logo-image", `url("${png}")`);
    document.documentElement.dataset.customLogoReady = "true";
    await update?.(png);
  }
}
