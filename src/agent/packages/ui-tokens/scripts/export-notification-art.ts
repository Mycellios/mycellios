import { readFile, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { MICO_AVATAR_SHAPES } from "../../contracts/src/bot-avatar.ts";
import { compactMicoArt, compactMicoEyes, compactMicoEyeColor, COMPACT_EYE_WIDTH, COMPACT_EYE_HEIGHT } from "../../core/src/compact-mico-avatar.ts";
const root = new URL("../../../", import.meta.url);
const path = (name: string) => fileURLToPath(new URL(name, root));
const target = "apps/web/public/mycellios";
await mkdir(path(`${target}/notification-micos`), { recursive: true });
await copyFile(path("apps/mobile/assets/notification-icon.png"), path(`${target}/notification-badge.png`));
const sheets = {
  mycelium: (await readFile(path("packages/core/assets/micos-mycelium-eyeless.png"))).toString("base64"),
  growth: (await readFile(path("packages/core/assets/micos-mycelium-growth-eyeless.png"))).toString("base64"),
};
for (const shape of MICO_AVATAR_SHAPES) {
  const art = compactMicoArt(shape.index);
  if (!art?.collection) throw new Error(`Missing velvet artwork for ${shape.id}`);
  const [x, y, side] = art.crop;
  const eyes = compactMicoEyes(art).map(eye => `<g transform="translate(${eye.x} ${eye.y}) ${eye.matrix}"><rect x="${-COMPACT_EYE_WIDTH / 2}" y="${-COMPACT_EYE_HEIGHT / 2}" width="${COMPACT_EYE_WIDTH}" height="${COMPACT_EYE_HEIGHT}" rx="${COMPACT_EYE_WIDTH / 2}"/></g>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 64 64">
    <svg width="64" height="64" viewBox="${x} ${y} ${side} ${side}" overflow="hidden">
      <image href="data:image/png;base64,${sheets[art.collection]}" width="1536" height="1024"/>
    </svg><g fill="${compactMicoEyeColor(shape.originalColor, art, true)}">${eyes}</g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path(`${target}/notification-micos/${shape.id}.png`));
}
console.log(`Exported ${MICO_AVATAR_SHAPES.length} mycelium notification avatars; spinner untouched.`);
