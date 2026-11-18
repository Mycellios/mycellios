import { appPath } from "../../lib/app-path";
export const encode = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
export const decode = (base64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
export const publishedWebPath = (slug: string) =>
  appPath(`/api/published-webs/${encodeURIComponent(slug)}/`);
export const issue = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "No se pudo completar la operación. Vuelve a intentarlo.";

export const CAPABILITY_LABELS = {
  downloads: "Descargar archivos",
  storage: "Guardar datos de cada usuario",
  files: "Guardar archivos grandes (vídeos, imágenes)",
} as const;
/**
 * The iframe sandbox intersects the server's CSP sandbox: both must allow a token.
 * Without grants this stays exactly `allow-scripts`.
 */
export function hostedFrameAttributes(capabilities: readonly string[] | undefined) {
  return {
    sandbox: capabilities?.includes("downloads")
      ? "allow-scripts allow-downloads"
      : "allow-scripts",
  };
}
