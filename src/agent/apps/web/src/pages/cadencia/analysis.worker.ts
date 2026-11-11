import { analyze, type Settings } from "./analysis";

const workerScope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<{ pcm: Float32Array; settings: Settings }>) => void)
    | null;
  postMessage: (message: unknown) => void;
};
workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      result: analyze(event.data.pcm, event.data.settings, (progress) =>
        workerScope.postMessage({ progress }),
      ),
    });
  } catch (error) {
    workerScope.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "No se pudo analizar este audio.",
    });
  }
};
