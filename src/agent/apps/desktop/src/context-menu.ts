import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from "electron";
import { clipboard, Menu } from "electron";

/** Spanish when the app runs in Spanish, English otherwise; the native menu has no web catalog. */
const LABELS = {
  en: { copyImage: "Copy image", copyLink: "Copy link", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all" },
  es: { copyImage: "Copiar imagen", copyLink: "Copiar enlace", cut: "Cortar", copy: "Copiar", paste: "Pegar", selectAll: "Seleccionar todo" },
};

/**
 * Electron shows no context menu by default. Offer the standard clipboard actions for what was
 * right-clicked: images, links, selected text and editable fields. Nothing else is exposed.
 */
export function contextMenuTemplate(
  params: Pick<ContextMenuParams, "x" | "y" | "mediaType" | "hasImageContents" | "linkURL" | "selectionText" | "isEditable" | "editFlags">,
  actions: { copyImage(x: number, y: number): void; copyText(text: string): void },
  locale = "en",
): MenuItemConstructorOptions[] {
  const label = locale.toLowerCase().startsWith("es") ? LABELS.es : LABELS.en;
  const groups: MenuItemConstructorOptions[][] = [];
  if (params.mediaType === "image" && params.hasImageContents)
    groups.push([{ label: label.copyImage, click: () => actions.copyImage(params.x, params.y) }]);
  const link = /^https?:|^mailto:/i.test(params.linkURL) ? params.linkURL : "";
  if (link) groups.push([{ label: label.copyLink, click: () => actions.copyText(link) }]);
  if (params.isEditable) {
    groups.push([
      { label: label.cut, role: "cut", enabled: params.editFlags.canCut },
      { label: label.copy, role: "copy", enabled: params.editFlags.canCopy },
      { label: label.paste, role: "paste", enabled: params.editFlags.canPaste },
      { label: label.selectAll, role: "selectAll", enabled: params.editFlags.canSelectAll },
    ]);
  } else if (params.selectionText.trim()) {
    groups.push([{ label: label.copy, role: "copy" }]);
  }
  return groups.flatMap((group, index) => index ? [{ type: "separator" as const }, ...group] : group);
}

export function attachContextMenu(contents: WebContents, locale: () => string): void {
  contents.on("context-menu", (_event, params) => {
    const template = contextMenuTemplate(params, {
      copyImage: (x, y) => contents.copyImageAt(x, y),
      copyText: text => clipboard.writeText(text),
    }, locale());
    if (template.length) Menu.buildFromTemplate(template).popup();
  });
}
