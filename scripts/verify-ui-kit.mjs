import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = process.cwd();
const primitives = "button|input|textarea|select|label|form|a|article|table|thead|tbody|tr|th|td|h[1-6]|p|details|summary";
const rawTag = new RegExp(`<(${primitives})(?=[\\s/>])`, "g");
const files = [];
const visualFiles = [];
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) walk(path);
    else if (!/\.(test|stories)\.[cm]?[jt]sx?$/.test(item.name)) {
      if (item.name.endsWith(".tsx")) files.push(path);
      if (/\.(?:css|svg|[cm]?[jt]sx?)$/.test(item.name)) visualFiles.push(path);
    }
  }
}
walk(resolve(root, "landing/src"));
walk(resolve(root, "src/mobile"));
// Public assets are not React controls, but follow the same flat-fill rule.
walk(resolve(root, "landing/public"));
const violations = [];
const gradient = /(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(|<(?:linear|radial)Gradient\b|\.create(?:Linear|Radial|Conic)Gradient\s*\(/g;
for (const file of visualFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(gradient)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative(root, file).replaceAll("\\", "/")}:${line} uses a gradient instead of a flat fill`);
  }
}
for (const file of files) {
  const name = relative(root, file).replaceAll("\\", "/");
  if (name === "landing/src/ui/primitives.tsx") continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(rawTag)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${name}:${line} uses <${match[1]}> instead of the shared kit`);
  }
}
const exports = ["primitives.tsx", "patterns.tsx", "Sidebar.tsx", "TablePagination.tsx"].map(file => readFileSync(resolve(root, "landing/src/ui", file), "utf8")).join("\n");
const storySource = readdirSync(resolve(root, "landing/src/ui")).filter(file => file.endsWith(".stories.tsx")).map(file => readFileSync(resolve(root, "landing/src/ui", file), "utf8")).join("\n");
for (const match of exports.matchAll(/export (?:function|const) (\w+)/g)) {
  if (/^[A-Z_]+$/.test(match[1])) continue;
  if (!new RegExp(`\\b${match[1]}\\b`).test(storySource)) violations.push(`No Storybook example for ${match[1]}`);
}
if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; }
else console.log(`UI kit verified across ${files.length} production TSX files; every primitive has a Storybook example.`);
