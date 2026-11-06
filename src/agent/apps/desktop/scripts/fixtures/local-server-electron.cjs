// This helper creates no BrowserWindow and cannot take focus from the developer.
const { app, utilityProcess } = require("electron");
const { join } = require("node:path");
const [configFile, entry, profile] = process.argv.slice(2);
app.setPath("userData", join(profile, "electron"));
app.disableHardwareAcceleration();
let child;
let restarts = 0;
let savedCookie = "";
let savedSkillId = "";
const timer = setTimeout(() => {
  console.log(JSON.stringify({phase:"timeout",ready:false}));
  child?.kill();
  app.exit(1);
}, 180000);
app
  .whenReady()
  .then(function launch() {
    child = utilityProcess.fork(entry, [], {
      env: { ...process.env, RAKAZO_LOCAL_SERVER_CONFIG: configFile },
      stdio: "pipe",
    });
    let output = "";
    child.stdout?.on("data", (data) => { output = (output + data).slice(-4000); });
    let errors = "";
    child.stderr?.on("data", (data) => {
      errors = (errors + data).slice(-6000);
    });
    let checked = false;
    child.on("message", async (message) => {
      if (message?.type !== "ready" || checked) return;
      try {
        const ready = await fetch(`${message.origin}/ready`);
        const page = await fetch(message.origin);
        if (!ready.ok || !page.ok || !(await page.text()).includes("<html"))
          throw new Error("Invalid local app response");
        const origin = message.origin;
        if (restarts) {
          const response = await fetch(`${origin}/rpc/agentSkills/get`, {
            method: "POST",
            headers: { origin, cookie: savedCookie, "content-type": "application/json" },
            body: JSON.stringify({ json: { skillId: savedSkillId } }),
          });
          const restored = response.ok ? (await response.json()).json : null;
          if (restored?.revision !== 3 || !restored.content.includes("Original fixture recipe."))
            throw new Error("Fixture persistence failed");
          checked = true;
          child.postMessage("stop");
          return;
        }
        const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            name: "Package fixture",
            email: "package-fixture@example.test",
            password: "FixturePassword!2026",
          }),
        });
        if (!signup.ok) throw new Error("Fixture signup failed");
        const cookie = signup.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const rpc = async (method, input) => {
          const response = await fetch(`${origin}/rpc/${method}`, {
            method: "POST",
            headers: { origin, cookie, "content-type": "application/json" },
            body: JSON.stringify({ json: input }),
          });
          if (!response.ok) throw new Error(`Fixture RPC failed: ${method} (${response.status})`);
          return (await response.json()).json;
        };
        await rpc("bootstrap", {});
        const skill = await rpc("agentSkills/create", {
          name: "Package fixture",
          description: "Synthetic package verification recipe",
          body: "Original fixture recipe.",
        });
        await rpc("agentSkills/update", {
          skillId: skill.id,
          expectedRevision: 1,
          body: "Updated fixture recipe.",
        });
        const restored = await rpc("agentSkills/restore", {
          skillId: skill.id,
          revision: 1,
          expectedRevision: 2,
        });
        if (restored.revision !== 3 || !restored.content.includes("Original fixture recipe."))
          throw new Error("Fixture skill restore failed");
        savedCookie = cookie;
        savedSkillId = skill.id;
        checked = true;
        child.postMessage("stop");
      } catch (error) {
        console.log(JSON.stringify({ phase: "http", error: error.message }));
        child.kill();
      }
    });
    child.once("exit", (code) => {
      if (checked && code === 0) {
        if (!restarts) {
          restarts = 1;
          launch();
          return;
        }
        clearTimeout(timer);
        console.log(
          JSON.stringify({
            electronUtility: true,
            ready: true,
            web: true,
            signup: true,
            skillRestore: true,
            cleanStop: true,
            restartRetainsData: true,
          }),
        );
        app.quit();
      } else {
        const detail = errors.slice(-2000) + "\n" + output.slice(-2000);
        console.log(
          JSON.stringify({
            phase: "server-exit",
            code,
            detail: detail
              .replace(/postgres(?:ql)?:\/\/\S+/g, "[fixture-db]")
              .replace(/\b[a-f0-9]{64}\b/g, "[fixture-secret]")
              .slice(-4000),
          }),
        );
        app.exit(1);
      }
    });
  })
  .catch(() => {
    clearTimeout(timer);
    app.exit(1);
  });
