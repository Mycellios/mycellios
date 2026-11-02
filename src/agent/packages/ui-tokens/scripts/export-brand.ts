import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { darkTokens, lightTokens } from "../src/index.ts";

const root = new URL("../../../", import.meta.url);
const path = (name: string) => fileURLToPath(new URL(name, root));
const source = await readFile(path("packages/ui-tokens/assets/mycellios-mark.svg"), "utf8");
const mark = source.slice(source.indexOf("  <mask"), source.lastIndexOf("</svg>"));
function artwork({
  rounded = false,
  foreground = false,
  scale = 1,
  color = lightTokens.background,
} = {}) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256">
    ${foreground ? "" : `<rect width="256" height="256" rx="${rounded ? 52 : 0}" fill="${darkTokens.background}"/>`}
    <g color="${color}" transform="translate(128 128) scale(${scale}) translate(-128 -128)">${mark}</g>
  </svg>`);
}
const square = artwork();
const rounded = artwork({ rounded: true });

async function png(input: Buffer, name: string, size: number) {
  const image = sharp(input).resize(size, size);
  if (
    name === "apps/mobile/assets/icon.png" ||
    name.includes("apple-touch-icon") ||
    name.endsWith("app-icon-v2-maskable.png")
  )
    image.removeAlpha();
  await image.png().toFile(path(name));
}

// PNG frames in ICO are supported by modern Windows and browser favicon loaders.
async function ico(input: Buffer, name: string, sizes: number[]) {
  const frames = await Promise.all(sizes.map((size) => sharp(input).resize(size).png().toBuffer()));
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(path(name), Buffer.concat([header, ...frames]));
}

for (const app of ["web"]) {
  const publicDir = `apps/${app}/public`;
  await png(rounded, `${publicDir}/favicon-16x16.png`, 16);
  await png(rounded, `${publicDir}/favicon-32x32.png`, 32);
  await png(rounded, `${publicDir}/favicon.png`, 128);
  await png(square, `${publicDir}/apple-touch-icon.png`, 180);
  await png(square, `${publicDir}/icon-192.png`, 192);
  await png(square, `${publicDir}/icon-512.png`, 512);
  await ico(rounded, `${publicDir}/favicon.ico`, [16, 32, 48]);
}
// Versioned URLs refresh installed launchers without changing their app identity or scope.
for (const size of [192, 512])
  await png(rounded, `apps/web/public/mycellios/app-icon-v2-${size}.png`, size);
await png(artwork({ scale: 0.96 }), "apps/web/public/mycellios/app-icon-v2-maskable.png", 512);
await png(square, "apps/web/public/mycellios/apple-touch-icon-v2.png", 180);
await png(rounded, "apps/web/public/mycellios/favicon-v2.png", 64);
await png(rounded, "apps/web/public/mycellios/app-icon.png", 512);
await png(rounded, "apps/web/public/mycellios/favicon.png", 64);
await png(rounded, "apps/mobile/assets/favicon.png", 128);
await png(rounded, "apps/desktop/assets/icon.png", 1024);
await png(artwork({ rounded: true, scale: 0.9 }), "apps/desktop/assets/icon-macos.png", 1024);
await ico(rounded, "apps/desktop/assets/icon.ico", [16, 24, 32, 48, 64, 128, 256]);
await png(square, "apps/mobile/assets/icon.png", 1024);
await png(artwork({ foreground: true, scale: 0.72 }), "apps/mobile/assets/adaptive-icon.png", 1024);
await png(
  artwork({ foreground: true, scale: 0.72, color: "white" }),
  "apps/mobile/assets/monochrome-icon.png",
  1024,
);
await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: darkTokens.background },
})
  .png()
  .toFile(path("apps/mobile/assets/icon-background.png"));

// The splash keeps its own padding, separate from the launcher safe area.
await png(
  artwork({ foreground: true, scale: 0.58, color: darkTokens.background }),
  "apps/mobile/assets/splash-icon.png",
  1024,
);
await png(
  artwork({ foreground: true, scale: 0.58 }),
  "apps/mobile/assets/splash-icon-dark.png",
  1024,
);

// Android notifications use a white alpha silhouette with a transparent hub.
await png(
  artwork({ foreground: true, color: "white" }),
  "apps/mobile/assets/notification-icon.png",
  96,
);
