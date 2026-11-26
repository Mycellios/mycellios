import { useCallback, useState } from "react";

/** Sidebar sections the person can fold. The choice is a device preference, per section. */
export type SidebarSection = "needs-you" | "projects";

const STORAGE_KEY = "mycellios.sidebar-sections.v1";

function readCollapsed(): Partial<Record<SidebarSection, boolean>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const value = parsed as Record<string, unknown>;
    return {
      ...(value["needs-you"] === true ? { "needs-you": true } : {}),
      ...(value.projects === true ? { projects: true } : {}),
    };
  } catch {
    return {};
  }
}

/** Whether a sidebar section is folded on this device, and a toggle that remembers it. */
export function useSidebarSectionCollapsed(section: SidebarSection) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed()[section] === true);
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        const saved = readCollapsed();
        if (next) saved[section] = true;
        else delete saved[section];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // Blocked storage keeps the choice for this visit only.
      }
      return next;
    });
  }, [section]);
  return [collapsed, toggle] as const;
}
