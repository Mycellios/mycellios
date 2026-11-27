import { memoryNotePath } from "@mycellios/contracts";

/** The same limits the create route applies, checked before anything is sent. */
export const IMPORT_MAX_FILES = 500;
export const IMPORT_MAX_CHARS = 64_000;

export type VaultFile = { path: string; content: string };
export type VaultGroupChoice = { key: string; label: string };

/** A folder name that survives every file system: no separators or reserved characters. */
export function safeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned || "Notes";
}

/**
 * One file per note, under a folder per group ("General", each Mico's name), keeping the
 * note's own folders. Two groups with the same name get distinct folders.
 */
export function vaultExportFiles(
  groups: readonly { label: string; notes: readonly { path: string; content: string }[] }[],
): VaultFile[] {
  const usedFolders = new Set<string>();
  const files: VaultFile[] = [];
  for (const group of groups) {
    const base = safeFolderName(group.label);
    let folder = base;
    for (let n = 2; usedFolders.has(folder.toLocaleLowerCase("und")); n += 1)
      folder = `${base} (${n})`;
    usedFolders.add(folder.toLocaleLowerCase("und"));
    for (const note of group.notes)
      files.push({ path: `${folder}/${note.path}`, content: note.content });
  }
  return files;
}

export type ImportItem = { group: string; path: string; content: string };
export type ImportSkip = {
  path: string;
  reason: "not_markdown" | "too_large" | "invalid_name" | "conversation_note";
};

/**
 * Turns picked files into notes to create. A top folder named like a group (as an export
 * writes them) goes to that group; anything else goes to the chosen destination. Task
 * conversation notes cannot be recreated, so they are skipped.
 */
export function vaultImportPlan(
  files: readonly VaultFile[],
  groups: readonly VaultGroupChoice[],
  destination: string,
  conversationsLabel: string,
): { items: ImportItem[]; skipped: ImportSkip[] } {
  const byFolder = new Map<string, string>();
  for (const group of groups) {
    const key = safeFolderName(group.label).toLocaleLowerCase("und");
    if (!byFolder.has(key)) byFolder.set(key, group.key);
  }
  const conversations = safeFolderName(conversationsLabel).toLocaleLowerCase("und");
  const items: ImportItem[] = [];
  const skipped: ImportSkip[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const parts = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (!/\.md$/i.test(parts.at(-1) ?? "")) {
      skipped.push({ path: file.path, reason: "not_markdown" });
      continue;
    }
    let group = destination;
    const top = parts.length > 1 ? byFolder.get(parts[0]!.toLocaleLowerCase("und")) : undefined;
    if (top) {
      group = top;
      parts.shift();
    }
    if (parts.length > 1 && parts[0]!.toLocaleLowerCase("und") === conversations) {
      skipped.push({ path: file.path, reason: "conversation_note" });
      continue;
    }
    if (file.content.length > IMPORT_MAX_CHARS) {
      skipped.push({ path: file.path, reason: "too_large" });
      continue;
    }
    const path = memoryNotePath(parts.join("/"));
    const key = `${group}\n${path?.toLocaleLowerCase("und")}`;
    if (!path || seen.has(key)) {
      skipped.push({ path: file.path, reason: "invalid_name" });
      continue;
    }
    seen.add(key);
    items.push({ group, path, content: file.content });
  }
  return { items, skipped };
}

/** Markdown files from a picked .zip (as an export writes it) or plain .md files. */
export async function readVaultFiles(picked: readonly File[]): Promise<VaultFile[]> {
  const files: VaultFile[] = [];
  for (const file of picked) {
    if (/\.zip$/i.test(file.name)) {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(file);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || entry.name.split("/").some((part) => part.startsWith("."))) continue;
        if (files.length >= IMPORT_MAX_FILES) break;
        files.push({
          path: entry.name,
          content: /\.md$/i.test(entry.name) ? await entry.async("string") : "",
        });
      }
    } else {
      const relative =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      files.push({ path: relative, content: /\.md$/i.test(file.name) ? await file.text() : "" });
    }
    if (files.length >= IMPORT_MAX_FILES) break;
  }
  return files.slice(0, IMPORT_MAX_FILES);
}

export async function vaultZip(files: readonly VaultFile[]): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of files) zip.file(file.path, file.content);
  return zip.generateAsync({ type: "uint8array" });
}
