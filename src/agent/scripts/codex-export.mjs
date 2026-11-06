import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_MARKDOWN_BYTES = 100_000;
const SAFE_CONFIG_KEYS = new Set(["model", "model_provider"]);

function slug(value) {
  const result = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return result || "codex-item";
}

async function regularFile(file) {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${file}`);
    return info.isFile() ? info : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function markdown(file) {
  const info = await regularFile(file);
  if (!info) return null;
  if (info.size > MAX_MARKDOWN_BYTES) throw new Error(`File is too large to import: ${file}`);
  return readFile(file, "utf8");
}

function tomlString(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return null;
}

export function safeCodexConfig(content) {
  const result = {};
  let topLevel = true;
  for (const rawLine of content.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      topLevel = false;
      continue;
    }
    if (!topLevel) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!match || !SAFE_CONFIG_KEYS.has(match[1])) continue;
    const value = tomlString(match[2]);
    if (value) result[match[1]] = value;
  }
  return result;
}

function preferenceMemory(config) {
  const rows = [
    config.model ? `- Preferred model: \`${config.model}\`` : "",
    config.model_provider ? `- Model provider: \`${config.model_provider}\`` : "",
  ].filter(Boolean);
  return rows.length ? `# Imported Codex preferences\n\n${rows.join("\n")}\n` : null;
}

async function writeText(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

async function directMarkdownFiles(directory) {
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${directory}`);
    if (!info.isDirectory()) return [];
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function copySkills(source, output, used) {
  const skillsDir = path.join(source, "skills");
  let entries;
  try {
    const info = await lstat(skillsDir);
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${skillsDir}`);
    if (!info.isDirectory()) return 0;
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  let count = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const content = await markdown(path.join(skillsDir, entry.name, "SKILL.md"));
    if (!content?.trim()) continue;
    const name = uniqueSlug(slug(entry.name), used);
    await writeText(output, path.join("skills", name, "SKILL.md"), content);
    count += 1;
  }
  return count;
}

function uniqueSlug(preferred, used) {
  let candidate = preferred;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${preferred}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

async function convertPrompts(source, output, used) {
  const promptsDir = path.join(source, "prompts");
  const names = await directMarkdownFiles(promptsDir);
  for (const file of names) {
    const content = await markdown(path.join(promptsDir, file));
    if (!content?.trim()) continue;
    const title = path.basename(file, path.extname(file));
    const name = uniqueSlug(slug(title), used);
    const skill = [
      "---",
      `name: ${name}`,
      `description: ${JSON.stringify(`Imported Codex prompt: ${title}`)}`,
      "---",
      "",
      content.trim(),
      "",
    ].join("\n");
    await writeText(output, path.join("skills", name, "SKILL.md"), skill);
  }
  return names.length;
}

export async function exportCodex({
  source = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  output = path.join(os.homedir(), "codex-mycellios-export"),
  force = false,
} = {}) {
  source = path.resolve(source);
  output = path.resolve(output);
  if (source === output || output.startsWith(`${source}${path.sep}`)) {
    throw new Error("Output must be outside the Codex home.");
  }
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error("Codex home must be a real directory.");
  }
  try {
    await lstat(output);
    if (!force) throw new Error(`Output already exists: ${output}. Use --force to replace it.`);
    await rm(output, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    const instructions = await markdown(path.join(source, "AGENTS.md"));
    if (instructions?.trim()) await writeText(temporary, "AGENTS.md", instructions);

    const configText = await markdown(path.join(source, "config.toml"));
    const config = safeCodexConfig(configText ?? "");
    const memory = preferenceMemory(config);
    if (memory) await writeText(temporary, "MEMORY.md", memory);

    const used = new Set();
    const skills = await copySkills(source, temporary, used);
    const prompts = await convertPrompts(source, temporary, used);
    if (!instructions?.trim() && !memory && !skills && !prompts) {
      throw new Error("No Codex instructions, prompts, skills, or safe preferences were found.");
    }

    await rename(temporary, output);
    return {
      output,
      instructions: Boolean(instructions?.trim()),
      preferences: Object.keys(config),
      prompts,
      skills,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--force") options.force = true;
    else if (value === "--source" || value === "--output") {
      const next = args[index + 1];
      if (!next) throw new Error(`${value} requires a path.`);
      options[value.slice(2)] = next;
      index += 1;
    } else throw new Error(`Unknown option: ${value}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportCodex(parseArguments(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
