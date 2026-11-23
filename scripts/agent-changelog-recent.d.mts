import type { Plugin } from "vite";
export function recentChangelogSections(markdown: string, releases: number, maximumCharacters?: number): string;
export function agentChangelogRecent(root?: string, releases?: number): Plugin;
