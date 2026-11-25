import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeAgentProcess } from "../packages/adapters/src/native-agent-process.js";
import { probeNativeSignIn } from "../packages/adapters/src/native-signin.js";
import {
  installNativeEngine,
  nativeEngineChannelRelease,
  nativeEngineTarget,
} from "../packages/adapters/src/native-engine-store.js";

const target = nativeEngineTarget();
assert.equal(target, process.argv[2], "Run the canary on the named native architecture");
assert.ok(target, "No managed CLI builds for this runner");

const root = await mkdtemp(join(tmpdir(), "mycellios-native-engine-canary-"));
const home = join(root, "home");
const engines = ["codex", "claude", "opencode"] as const;
const requestedEngine = process.argv[3];
const selectedEngines = engines.filter(engine => !requestedEngine || engine === requestedEngine);

try {
  assert.ok(selectedEngines.length, "Choose codex, claude or opencode");
  await mkdir(home);
  // The canary runs alone in this process. CLI probes receive a clean home and the
  // same credentials-free environment as production native turns.
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
  });
  let failures = 0;
  for (const engine of selectedEngines) {
    let version = "unknown";
    let step = "load vendor release metadata";
    try {
      const release = await nativeEngineChannelRelease(engine, { target });
      assert.ok(release, "The channel has no release for this target");
      version = release.version;
      step = "verify download and start binary";
      const installed = await installNativeEngine(root, engine, { release, target });
      step = "complete the CLI protocol probe";
      if (engine === "claude") {
        assert.equal(await probeNativeSignIn(engine, installed.command), false);
      } else {
        const clientInfo = { name: "mycellios-native-engine-canary", version: "1" };
        const args = engine === "codex" ? ["app-server", "-c", "mcp_servers={}"] : [];
        const child = new NativeAgentProcess(installed.command, args, home, () => {}, () => {});
        try {
          const params = engine === "codex"
            ? { clientInfo, capabilities: { experimentalApi: true } }
            : { clientInfo, protocolVersion: 1, clientCapabilities: {} };
          const response = await child.request<{ protocolVersion?: number }>("initialize", params, 15_000);
          assert.ok(response);
          if (engine === "codex") child.send({ method: "initialized", params: {} });
          else assert.equal(response.protocolVersion, 1);
        } finally {
          await child.stop();
        }
      }
      console.log(`${engine} ${version} ${target}: passed`);
    } catch {
      failures++;
      console.error(`${engine} ${version} ${target}: failed to ${step}`);
    }
  }
  if (failures) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
