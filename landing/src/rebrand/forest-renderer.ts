import { containScene, createGrowthField, growthAlpha, interpolateRect, type SceneRect } from "./forest-growth";

export interface ForestFrame { growth: number; leaving: number }
export type ForestPictures = readonly [HTMLImageElement, HTMLImageElement, HTMLImageElement];

export function createForestRenderer(canvas: HTMLCanvasElement, pictures: ForestPictures, readTarget: () => SceneRect | null) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("forest_canvas_unavailable");
  const portrait = pictures[0].naturalWidth < pictures[0].naturalHeight;
  const mask = document.createElement("canvas");
  mask.width = portrait ? 160 : 320; mask.height = portrait ? 240 : 160;
  const maskContext = mask.getContext("2d")!;
  const maskPixels = maskContext.createImageData(mask.width, mask.height);
  const field = createGrowthField(mask.width, mask.height);
  for (let i = 0; i < field.length; i++) maskPixels.data.fill(255, i * 4, i * 4 + 3);
  const layer = document.createElement("canvas");
  layer.width = pictures[0].naturalWidth; layer.height = pictures[0].naturalHeight;
  const layerContext = layer.getContext("2d")!;
  let width = 1, height = 1, target: SceneRect | null = null;
  let current: ForestFrame = { growth: 0, leaving: 0 };
  let lastGrowth = -1;

  function render(frame: ForestFrame) {
    current = { ...frame };
    const ctx = context!;
    const scene = containScene(width, height, pictures[0].naturalWidth / pictures[0].naturalHeight);
    if (frame.leaving > 0 && !target) target = readTarget();
    if (frame.growth !== lastGrowth) {
      for (let i = 0; i < field.length; i++) maskPixels.data[i * 4 + 3] = growthAlpha(field[i]!, frame.growth);
      maskContext.putImageData(maskPixels, 0, 0);
      layerContext.globalCompositeOperation = "source-over";
      layerContext.clearRect(0, 0, layer.width, layer.height);
      layerContext.drawImage(pictures[1], 0, 0, layer.width, layer.height);
      layerContext.globalCompositeOperation = "destination-in";
      layerContext.drawImage(mask, 0, 0, layer.width, layer.height);
      lastGrowth = frame.growth;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1 - frame.leaving;
    ctx.fillStyle = "#17221a"; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(pictures[0], scene.x, scene.y, scene.width, scene.height);
    ctx.drawImage(layer, scene.x, scene.y, scene.width, scene.height);
    if (frame.leaving > 0) {
      // Match the final illustration to its actual position in the live landing.
      const equipment = { x: scene.x + scene.width * .045, y: scene.y + scene.height * (portrait ? .21 : .045),
        width: scene.width * .91, height: scene.height * (portrait ? .61 : .83) };
      const destination = interpolateRect(equipment, target ?? equipment, frame.leaving);
      ctx.globalAlpha = Math.min(1, frame.leaving * 1.5) * Math.min(1, (1 - frame.leaving) * 10);
      ctx.drawImage(pictures[2], destination.x, destination.y, destination.width, destination.height);
    }
    ctx.globalAlpha = 1;
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width; height = bounds.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    target = null; render(current);
  }
  resize();
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  return { render, reset() { target = null; },
    destroy() { observer.disconnect(); canvas.width = 1; canvas.height = 1; layer.width = 1; layer.height = 1; } };
}
