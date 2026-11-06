import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportCodex, safeCodexConfig } from "./codex-export.mjs";

const roots = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "mycellios-codex-")),
  );
  roots.push(root);
  const source = path.join(root, ".codex");
  const output = path.join(root, "export");
  await mkdir(path.join(source, "prompts"), { recursive: true });
  await mkdir(path.join(source, "skills", "review"), { recursive: true });
  return { source, output };
}

describe("safeCodexConfig", () => {
  it("keeps only top-level model preferences", () => {
    expect(
      safeCodexConfig([
        'model = "gpt-5.4"',
        "model_provider = 'openai'",
        'approval_policy = "never"',
        "[mcp_servers.private]",
        'url = "https://example.test/?token=secret-value"',
      ].join("\n")),
    ).toEqual({ model: "gpt-5.4", model_provider: "openai" });
  });
});

describe("exportCodex", () => {
  it("exports instructions, prompts, skills and allowlisted preferences without secrets", async () => {
    const { source, output } = await fixture();
    await writeFile(path.join(source, "AGENTS.md"), "Be concise.\n");
    await writeFile(path.join(source, "prompts", "release.md"), "Prepare a release for $ARGUMENTS.\n");
    await writeFile(
      path.join(source, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review changes\n---\n\nReview carefully.\n",
    );
    await writeFile(
      path.join(source, "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "openai"',
        "[mcp_servers.private]",
        'bearer_token = "secret-value"',
      ].join("\n"),
    );
    await writeFile(path.join(source, "auth.json"), '{"token":"secret-value"}');
    await writeFile(path.join(source, "history.jsonl"), "secret-value");

    const result = await exportCodex({ source, output });
    expect(result).toMatchObject({ instructions: true, prompts: 1, skills: 1 });
    expect(await readFile(path.join(output, "AGENTS.md"), "utf8")).toBe("Be concise.\n");
    expect(await readFile(path.join(output, "MEMORY.md"), "utf8")).toContain("gpt-5.4");
    expect(await readFile(path.join(output, "skills", "release", "SKILL.md"), "utf8")).toContain(
      "Prepare a release",
    );
    const exported = await Promise.all([
      readFile(path.join(output, "AGENTS.md"), "utf8"),
      readFile(path.join(output, "MEMORY.md"), "utf8"),
      readFile(path.join(output, "skills", "release", "SKILL.md"), "utf8"),
      readFile(path.join(output, "skills", "review", "SKILL.md"), "utf8"),
    ]).then((items) => items.join("\n"));
    expect(exported).not.toContain("secret-value");
  });

  it("refuses to overwrite output unless force is explicit", async () => {
    const { source, output } = await fixture();
    await writeFile(path.join(source, "AGENTS.md"), "Keep it safe.\n");
    await mkdir(output);
    await expect(exportCodex({ source, output })).rejects.toThrow("Use --force");
  });
});
