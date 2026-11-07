import { useCallback, useEffect, useState } from "react";

function collapsedSidebarSectionsStorageKey(userId: string | null | undefined, mobile: boolean): string | null {
  if (!userId) return null;
  return `rakazo:collapsed-sidebar-sections:${mobile ? "mobile:" : ""}${userId}`;
}

function readCollapsedIdSet(storageKey: string | null): Set<string> {
  if (!storageKey) return new Set();
  try {
    const value = window.localStorage.getItem(storageKey);
    const keys: unknown = value ? JSON.parse(value) : [];
    return new Set(
      Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function toggleCollapsedIdSet(
  previous: ReadonlySet<string>,
  id: string,
  storageKey: string | null,
): Set<string> {
  const next = new Set(previous);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  if (storageKey) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Keep the UI usable when storage is unavailable.
    }
  }
  return next;
}

export function useSidebarExpansion(userId: string | null | undefined, mobile = false) {
  const storageKey = collapsedSidebarSectionsStorageKey(userId, mobile);
  const [collapsedSidebarSections, setCollapsedSidebarSections] = useState(() => new Set<string>());

  useEffect(() => {
    setCollapsedSidebarSections(readCollapsedIdSet(storageKey));
  }, [storageKey]);
  const toggleSidebarSection = useCallback(
    (key: string) => {
      setCollapsedSidebarSections((previous) =>
        toggleCollapsedIdSet(previous, key, storageKey),
      );
    },
    [storageKey],
  );
  return {
    collapsedSidebarSections,
    toggleSidebarSection,
  };
}
