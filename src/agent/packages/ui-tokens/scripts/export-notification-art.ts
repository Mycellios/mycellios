import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { MICO_AVATAR_SHAPES } from "../../contracts/src/bot-avatar.ts";
import { micoAvatarArt } from "../../core/src/mico-avatar-art.ts";
import { MICO_EYE_PATHS, MICO_PLUSH_CROPS } from "../../ui-web/src/mico-avatar-sprites.ts";

const root = new URL("../../../", import.meta.url);
const path = (name: string) => fileURLToPath(new URL(name, root));
const target = "apps/web/public/mycellios";
const iconSize = 96;

/** Isolate the mascot from stray pixels and neighboring crops in the shared atlas. */
function isolateMascot(pixels: Buffer) {
  const labels = new Uint16Array(iconSize * iconSize);
  let label = 0;
  let largest: number[] = [];
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (labels[pixel] || pixels[pixel * 4 + 3]! < 128) continue;
    label += 1;
    const component = [pixel];
    labels[pixel] = label;
    for (const current of component) {
      const column = current % iconSize;
      for (const next of [
        column > 0 ? current - 1 : -1,
        column < iconSize - 1 ? current + 1 : -1,
        current - iconSize,
        current + iconSize,
      ]) {
        if (next < 0 || next >= labels.length || labels[next] || pixels[next * 4 + 3]! < 128) continue;
        labels[next] = label;
        component.push(next);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const mask = new Uint8Array(labels.length);
  // Keep one pixel of the antialiased outline, without importing adjacent shapes.
  for (const pixel of largest) {
    const x = pixel % iconSize;
    const y = Math.floor(pixel / iconSize);
    for (let row = Math.max(0, y - 1); row <= Math.min(iconSize - 1, y + 1); row += 1) {
      mask.fill(1, row * iconSize + Math.max(0, x - 1), row * iconSize + Math.min(iconSize, x + 2));
    }
  }
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (!mask[pixel]) pixels.fill(0, pixel * 4, pixel * 4 + 4);
  }
  return pixels;
}

await mkdir(path(`${target}/notification-micos`), { recursive: true });
await copyFile(path("apps/mobile/assets/notification-icon.png"), path(`${target}/notification-badge.png`));

await Promise.all(MICO_AVATAR_SHAPES.map(async (shape, index) => {
  const { id } = shape;
  const destination = path(`${target}/notification-micos/${id}.png`);
  const atlasCrop = MICO_PLUSH_CROPS[index];
  if (!atlasCrop) {
    const art = micoAvatarArt(shape.index, shape.originalColor);
    if (!art) throw new Error(`Missing notification artwork for ${id}`);
    const eyes = art.eyes.map(([x, y, w, h]) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}"/>`).join("");
    const nose = art.nose ? `<path d="${art.nose}"/>` : "";
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="-4 -4 72 72">
      <path d="${art.path}" fill="${art.color}"/>
      <g fill="${art.eyeColor}">${eyes}${nose}</g>
    </svg>`);
    await sharp(svg).png().toFile(destination);
    return;
  }
  const [bounds, leftEye, rightEye] = atlasCrop;
  const [left, top, size] = bounds.split(" ").map(Number) as [number, number, number];
  const sheet = index < 5 ? "base" : "coleccion";
  const crop = await sharp(path(`packages/ui-web/src/assets/micos-terciopelo-${sheet}.png`))
    .extract({ left, top, width: size, height: size }).png().toBuffer();
  const eyes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${bounds}">
    <g fill="#30201e" stroke="#f9ead288">
      <path d="${MICO_EYE_PATHS[0]}" transform="translate(${leftEye.join(" ")}) scale(1.9)"/>
      <path d="${MICO_EYE_PATHS[0]}" transform="translate(${rightEye.join(" ")}) scale(-1.9 1.9)"/>
    </g>
  </svg>`);
  const face = await sharp(crop).composite([{ input: eyes }]).png().toBuffer();
  const pixels = await sharp(face).resize(iconSize, iconSize).ensureAlpha().raw().toBuffer();
  await sharp(isolateMascot(pixels), { raw: { width: iconSize, height: iconSize, channels: 4 } })
    .png().toFile(destination);
}));
