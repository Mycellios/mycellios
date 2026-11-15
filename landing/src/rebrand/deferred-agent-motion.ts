/** The static hero and its independent mycelium render before optional timelines. */
export function loadAfterFirstPaint<T>(load: () => Promise<T>): Promise<T> {
  return new Promise<void>(resolve => {
    const painted = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 1500 });
      else window.setTimeout(resolve, 250);
    }));
    if (document.readyState === "complete") painted();
    else window.addEventListener("load", painted, { once: true });
  }).then(load);
}

let motion: Promise<typeof import("./agent-hero-motion")> | undefined;
export function loadAgentMotion() {
  return motion ??= loadAfterFirstPaint(() => import("./agent-hero-motion"));
}
