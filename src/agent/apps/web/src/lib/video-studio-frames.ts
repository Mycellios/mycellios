import type { VideoScene } from "../../../../packages/contracts/src/app-studio.js";

/** Trusted v1 composition. User content is drawn as text, never interpreted as HTML/SVG/code. */
export function videoStudioFrames(scenes: VideoScene[]): string[] {
  return scenes.map((scene, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este navegador no puede preparar las imágenes.");
    ctx.fillStyle = index % 2 ? "#19372d" : "#f4f0e7";
    ctx.fillRect(0, 0, 720, 1280);
    ctx.fillStyle = index % 2 ? "#f4f0e7" : "#19372d";
    ctx.font = "24px sans-serif";
    ctx.fillText(`MYCELLIOS / ${String(index + 1).padStart(2, "0")}`, 60, 105);
    const wrap = (text: string, y: number, requestedSize: number, maxHeight: number) => {
      let size = requestedSize;
      let lines: string[];
      do {
        ctx.font = `${requestedSize >= 45 ? "bold " : ""}${size}px sans-serif`;
        lines = [];
        let line = "";
        for (const word of text.split(/\s+/)) {
          if (ctx.measureText(line + word).width > 590 && line) {
            lines.push(line.trim());
            line = "";
          }
          for (const character of word + " ") {
            if (ctx.measureText(line + character).width > 590) {
              lines.push(line.trim());
              line = "";
            }
            line += character;
          }
        }
        lines.push(line.trim());
        if (lines.length * size * 1.3 <= maxHeight || size <= 18) break;
        size -= 2;
      } while (true);
      for (const line of lines) {
        ctx.fillText(line, 60, y);
        y += size * 1.3;
      }
      return y;
    };
    const bottom = wrap(scene.title, 270, 60, 340);
    ctx.fillRect(60, bottom + 25, 80, 5);
    wrap(scene.narration, bottom + 110, 32, 420);
    ctx.font = "22px sans-serif";
    ctx.fillText(`${index + 1} / 6`, 60, 1170);
    return canvas.toDataURL("image/png");
  });
}
