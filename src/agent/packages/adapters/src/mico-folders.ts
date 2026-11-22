import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Folder name for a Mico whose name is unknown when its folder is first created. */
const FALLBACK_NAME = "Mico";
/** Code points kept from a Mico name; leaves room for a suffix within every OS limit. */
const MAX_NAME_LENGTH = 60;
/** UTF-8 bytes kept from a Mico name; Linux and macOS allow 255 per path component. */
const MAX_NAME_BYTES = 160;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
// Characters that Windows, macOS or Linux refuse in a file name; control characters too.
const RESERVED_CHARACTERS = new Set('<>:"/\\|?*');
const unsafe = (character: string) => {
  const code = character.codePointAt(0)!;
  return code < 0x20 || code === 0x7f || RESERVED_CHARACTERS.has(character);
};

/**
 * Turns a Mico name into one folder name that Windows, macOS and Linux all accept: no path
 * separators or reserved characters, no reserved device names, no leading or trailing dots
 * and spaces, and a bounded length.
 */
export function safeMicoFolderName(name: string | undefined): string {
  let value = [...(name ?? "").normalize("NFC")]
    .map((character) => (unsafe(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ");
  value = trimEdges(value);
  let kept = "";
  let count = 0;
  for (const character of value) {
    if (count >= MAX_NAME_LENGTH || Buffer.byteLength(kept + character) > MAX_NAME_BYTES) break;
    kept += character;
    count += 1;
  }
  value = trimEdges(kept);
  if (!value) return FALLBACK_NAME;
  if (WINDOWS_RESERVED.test(value)) value = `${value} Mico`;
  return value;
}

function trimEdges(value: string) {
  return value.replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
}

/**
 * Where each Mico's folder on this PC lives.
 *
 * A Mico that already has a home in the app's private folder keeps it there; its files are
 * never moved or copied. A Mico without one gets a visible folder under `visibleRoot`, named
 * after the Mico when the folder is created. The choice is saved, so renaming the Mico later
 * does not move or rename its folder.
 */
export class MicoFolders {
  private readonly folders = new Map<string, string>();

  constructor(
    private readonly options: {
      /** The app-private folder holding the existing `<key>` homes. */
      hiddenRoot: string;
      /** Parent of the visible Mico folders; absent keeps every home private. */
      visibleRoot?: string;
      /** App-private record of the visible folder chosen for each key. */
      stateFile: string;
    },
  ) {
    if (!options.visibleRoot) return;
    try {
      const saved = JSON.parse(readFileSync(options.stateFile, "utf8")) as {
        version?: unknown;
        folders?: Record<string, unknown>;
      };
      if (saved?.version !== 1 || !saved.folders || typeof saved.folders !== "object") return;
      for (const [key, folder] of Object.entries(saved.folders)) {
        if (/^[a-f0-9]{64}$/.test(key) && typeof folder === "string" && isStoredName(folder))
          this.folders.set(key, folder);
      }
    } catch {
      // No saved choices yet, or an unreadable record: existing private homes still resolve,
      // and the record is written again on the next new folder.
    }
  }

  /** The existing home of `key`, without choosing a new folder. */
  existing(key: string): string | undefined {
    const visible = this.visible(key);
    if (visible) return visible;
    const hidden = this.hidden(key);
    return existsSync(hidden) ? hidden : undefined;
  }

  /**
   * The home of `key`. `name` names a new visible folder; a home that already exists, private
   * or visible, keeps its location whatever the name is now. `privateOnly` keeps a new home in
   * the app's private folder (task worktree keys are not Micos).
   */
  resolve(key: string, name?: string, privateOnly = false): string {
    const found = this.existing(key);
    if (found) return found;
    if (privateOnly || !this.options.visibleRoot) return this.hidden(key);
    const folder = this.choose(key, name);
    this.folders.set(key, folder);
    try {
      this.persist();
    } catch (error) {
      this.folders.delete(key);
      throw error;
    }
    return path.join(this.options.visibleRoot, folder);
  }

  private hidden(key: string) {
    return path.join(this.options.hiddenRoot, key);
  }

  private visible(key: string) {
    const folder = this.folders.get(key);
    return folder && this.options.visibleRoot
      ? path.join(this.options.visibleRoot, folder)
      : undefined;
  }

  /** The Mico's name, or the name with a short id from the key when that one is taken. */
  private choose(key: string, name: string | undefined) {
    const base = safeMicoFolderName(name);
    const id = createHash("sha256").update(key).digest("hex");
    for (const candidate of [base, `${base} ${id.slice(0, 6)}`, `${base} ${id.slice(0, 12)}`]) {
      if (!this.taken(candidate)) return candidate;
    }
    return `${base} ${id}`;
  }

  private taken(folder: string) {
    // Windows and macOS compare file names without case.
    const wanted = folder.toLowerCase();
    for (const used of this.folders.values()) if (used.toLowerCase() === wanted) return true;
    return existsSync(path.join(this.options.visibleRoot!, folder));
  }

  private persist() {
    mkdirSync(path.dirname(this.options.stateFile), { recursive: true });
    const temporary = `${this.options.stateFile}.${process.pid}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({ version: 1, folders: Object.fromEntries(this.folders) }),
      { mode: 0o600 },
    );
    renameSync(temporary, this.options.stateFile);
  }
}

function isStoredName(folder: string) {
  return (
    folder.length > 0 &&
    folder.length <= 200 &&
    ![...folder].some(unsafe) &&
    folder === trimEdges(folder) &&
    !WINDOWS_RESERVED.test(folder)
  );
}
