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
