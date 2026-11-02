import type { BrowserWindow } from "electron";

export async function nativeProjectSpace(stable: BrowserWindow): Promise<string | null> {
  const value: unknown = await stable.webContents.executeJavaScript(
    'localStorage.getItem("rakazo:space-id")',
  );
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32)
  )
    throw new Error("Invalid selected Space");
  return value;
}

/** Read only non-secret scope identifiers from the trusted application's current session. */
export async function nativePreviewContext(
  stable: BrowserWindow,
): Promise<[string | null, string | null]> {
  const value = await stable.webContents.executeJavaScript(
    '([document.documentElement.getAttribute("data-preview-owner"), localStorage.getItem("rakazo:space-id")])',
  );
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some(
      (item) =>
        item !== null &&
        (typeof item !== "string" ||
          item.length > 256 ||
          Array.from(item).some((c) => c.charCodeAt(0) < 32)),
    )
  )
    throw new Error("Invalid preview owner context");
  return value as [string | null, string | null];
}
