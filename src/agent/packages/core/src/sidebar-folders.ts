export const SIDEBAR_FOLDER_LEVELS = 3;
export type SidebarFolder = { id: string; name: string; parentId?: string | null };

export class SidebarFolderError extends Error {
  constructor(public readonly code: "folder_parent_invalid" | "folder_depth_exceeded") {
    super(code === "folder_depth_exceeded" ? "Folders support up to three levels." : "A folder cannot be moved into itself or one of its subfolders.");
    this.name = "SidebarFolderError";
  }
}

/** Read old flat layouts and recover malformed parents without losing any folder. */
export function sidebarFolderTree<T extends SidebarFolder>(folders: readonly T[]) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const ancestors = (folder: T): T[] => {
    const seen = new Set([folder.id]);
    const result: T[] = [];
    let next = folder.parentId;
    while (next) {
      const parent = byId.get(next);
      if (!parent || seen.has(next) || result.length >= SIDEBAR_FOLDER_LEVELS - 1) return [];
      seen.add(next); result.unshift(parent); next = parent.parentId;
    }
    return result;
  };
  const rows = folders.map(folder => {
    const parents = ancestors(folder);
    return { ...folder, parentId: parents.at(-1)?.id ?? null, ancestorIds: parents.map(parent => parent.id), depth: parents.length,
      path: [...parents.map(parent => parent.name), folder.name].join(" / ") };
  });
  const result: typeof rows = [];
  const visit = (parentId: string | null) => {
    for (const row of rows) if (row.parentId === parentId) { result.push(row); visit(row.id); }
  };
  visit(null);
  return result;
}

/** Validate the entire moved subtree, not just the folder's new parent. */
export function assertSidebarFolderParent(folders: readonly SidebarFolder[], folderId: string | null, parentId: string | null) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const seen = new Set(folderId ? [folderId] : []);
  let depth = 1, next = parentId;
  while (next) {
    const parent = byId.get(next);
    if (!parent || seen.has(next)) throw new SidebarFolderError("folder_parent_invalid");
    seen.add(next); depth++; next = parent.parentId ?? null;
  }
  const height = (id: string, path: Set<string>): number => {
    if (path.has(id)) throw new SidebarFolderError("folder_parent_invalid");
    const visited = new Set(path).add(id);
    return 1 + Math.max(0, ...folders.filter(folder => folder.parentId === id).map(child => height(child.id, visited)));
  };
  if (depth + (folderId ? height(folderId, new Set()) - 1 : 0) > SIDEBAR_FOLDER_LEVELS)
    throw new SidebarFolderError("folder_depth_exceeded");
}
