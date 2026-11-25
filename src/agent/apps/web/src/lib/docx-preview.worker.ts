import { convertDocxToHtml } from "./docx-convert";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null;
  postMessage: (message: { html?: string; error?: true }) => void;
};

workerScope.onmessage = (event) => {
  convertDocxToHtml(event.data).then(
    (html) => workerScope.postMessage({ html }),
    () => workerScope.postMessage({ error: true }),
  );
};
