# Import an OpenAI Codex setup

Mycellios can migrate the reusable parts of a local Codex setup without copying credentials or runtime history.

## Export

From `src/agent`, run:

```bash
npm run codex:export
```

The command reads `$CODEX_HOME` or `~/.codex` and creates `~/codex-mycellios-export`.
Use a different location when needed:

```bash
npm run codex:export -- --source ~/.codex --output ~/my-codex-export
```

Add `--force` only when you intend to replace an existing export.

## Import

Open **Settings → Agents → Import agent** in Mycellios and select the generated folder.
Review every proposed instruction, memory document, and skill before creating or updating a bot.

The export maps:

- `AGENTS.md` to working instructions;
- top-level `model` and `model_provider` from `config.toml` to a preference memory document;
- `prompts/*.md` to reusable skills;
- each `skills/*/SKILL.md` to a Mycellios skill.

## Security boundary

The exporter reads only the known files above. It never reads or exports `auth.json`, history, sessions, logs, MCP credentials, environment values, headers, URLs, commands, or project-specific tables from `config.toml`.

Symbolic links are rejected, Markdown files are limited to 100 KB, the raw `config.toml` is never copied, and existing output is not overwritten without `--force`.
