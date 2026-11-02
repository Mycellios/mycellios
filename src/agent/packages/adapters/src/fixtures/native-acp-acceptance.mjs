// Real ACP acceptance: private model selection and no user-installed tools or plugins.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [command, model, trace] = process.argv.slice(2);
if (!command || !model || !trace) throw new Error("Missing ACP acceptance configuration");
let globalMcp = {};
try {
  globalMcp =
    JSON.parse(
      readFileSync(
        join(process.env.USERPROFILE ?? process.env.HOME, ".config/opencode/opencode.json"),
        "utf8",
      ),
    ).mcp ?? {};
} catch {
  /* Optional developer configuration. */
}
const mcp = Object.fromEntries(Object.keys(globalMcp).map((name) => [name, { enabled: false }]));
const child = spawn(command, ["acp"], {
  env: {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model,
      mcp,
      permission: { "*": "deny", "rakazo_*": "allow" },
    }),
    OPENCODE_PURE: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
process.stdin.pipe(child.stdin);
child.stderr.pipe(process.stderr);
let buffer = "";
let count = 0;
child.stdout.on("data", (data) => {
  process.stdout.write(data);
  buffer += data;
  for (;;) {
    const end = buffer.indexOf("\n");
    if (end < 0) break;
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      const item = JSON.parse(line);
      const update = item.params?.update;
      if (++count > 1000) continue;
      appendFileSync(
        trace,
        `${JSON.stringify({
          method: item.method,
          errorCode: item.error?.code,
          model: item.result?.models?.currentModelId,
          stopReason: item.result?.stopReason,
          update: update?.sessionUpdate,
          toolKind: update?.kind ?? item.params?.toolCall?.kind,
          title: item.params?.toolCall?.title,
          status: update?.status,
        })}\n`,
      );
    } catch {
      /* Diagnostics never alter the relayed wire stream. */
    }
  }
});
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
