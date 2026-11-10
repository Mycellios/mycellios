import { execFile } from "node:child_process";

export function validDesktopIcon(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > 90_000 || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(value)) return false;
  const png = Buffer.from(value.slice(22), "base64");
  return png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    png.toString("ascii", 12, 16) === "IHDR" && png.readUInt32BE(16) > 0 && png.readUInt32BE(16) <= 256 && png.readUInt32BE(20) > 0 && png.readUInt32BE(20) <= 256;
}
export async function installedFonts(platform: string): Promise<string[]> {
  const command = platform === "win32" ? "powershell.exe" : platform === "darwin" ? "/usr/sbin/system_profiler" : "fc-list";
  // Fixed OS commands: no renderer-supplied path, arguments or shell text.
  const args = platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts') | ForEach-Object { if(Test-Path -LiteralPath $_){ (Get-Item -LiteralPath $_).GetValueNames() } } | ConvertTo-Json -Compress"] :
    platform === "darwin" ? ["SPFontsDataType", "-json"] : ["--format", "%{family}\n"];
  const text = await new Promise<string>((resolve, reject) => execFile(command, args, { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
    (error, stdout) => error ? reject(error) : resolve(stdout)));
  let names: string[] = [];
  if (platform === "win32") {
    const parsed = JSON.parse(text); names = (Array.isArray(parsed) ? parsed : [parsed]).filter((v): v is string => typeof v === "string").map(name => name.replace(/\s*\((?:TrueType|OpenType)\)$/i, ""));
  } else if (platform === "darwin") {
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
        if ((key === "family" || key === "family_name") && typeof item === "string") names.push(item); else if (typeof item === "object") walk(item);
      }
    }; walk(JSON.parse(text));
  } else names = text.split(/[\n,]/);
  return [...new Set(names.map(name => name.trim()).filter(name => /^[\p{L}\p{N} ._'()\-+]+$/u.test(name) && name.length <= 100))].sort().slice(0, 500);
}
