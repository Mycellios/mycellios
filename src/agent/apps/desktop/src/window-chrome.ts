import type { BrowserWindow } from "electron";

/**
 * Caption controls belong to the OS title bar on Windows and Linux, and to the
 * macOS traffic lights. Do not cover the page with a host strip or overlay.
 */
export function installWindowChrome(_win: BrowserWindow, _platform: NodeJS.Platform): void {}
