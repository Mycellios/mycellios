import { existsSync } from "node:fs";
import path from "node:path";

/** Static files live beside the compiled entry, including inside app.asar. */
export function windowIcon(compiledDirectory: string, appDirectory: string, platform: NodeJS.Platform) {
  const name = platform === "darwin" ? "icon-macos.png" : "icon.png";
  return [path.join(compiledDirectory, "assets", name), path.join(appDirectory, "assets", name)]
    .find(file => existsSync(file));
}
