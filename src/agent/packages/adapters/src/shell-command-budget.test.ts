import { expect, it, vi } from "vitest";
import { isBoundedSearchCommand, shellCommandTimeoutMs, planShellSearch } from "./shell-command-budget.js";
it("caps the exact wide home search that left Videos waiting, including a larger requested budget", () => {
  const command = 'cd ~ && find . -maxdepth 6 -iname "voice.json" 2>/dev/null | head; echo "=== grep"; grep -rl "AndorraExplicatiu" --include="*.tsx" . 2>/dev/null | head -5; ls -la ~/bots/*/artifacts 2>/dev/null | head';
  expect(isBoundedSearchCommand(command)).toBe(true);
  expect(shellCommandTimeoutMs(command, 3_600_000)).toBe(45_000);
  expect(shellCommandTimeoutMs(command, 15_000)).toBe(15_000);
});
it.each(['cd ~ && find . -name "*.ts"', 'find / -name foo', 'find -L / -name foo', 'rg foo C:\\', 'grep -r foo ..', 'rg foo /c/Users/alex'])('refuses a whole-home/drive/parent scan before execution: %s', command => {
  expect(planShellSearch(command, undefined, { home: "C:\\Users\\alex" }).refusal).toContain("not started");
});
it.each(['rg -n foo src', 'grep -rn foo src | head -20', 'find src -name "*.ts"', 'rg --files src'])('permits bounded result-driven extension: %s', command => {
  expect(planShellSearch(command).progress).toEqual({ maxMs: 180_000, roots: ["src"] });
});
it("requires an identified project for an implicit dot scope and preserves explicit budgets", () => {
  expect(planShellSearch('find . -name "*.ts"').progress).toBeUndefined();
  expect(planShellSearch('find . -name "*.ts"', undefined, { cwd: "/home/alex/project", home: "/home/alex" }).progress?.maxMs).toBe(180_000);
  expect(planShellSearch('rg foo src', 60_000).progress?.maxMs).toBe(60_000);
  expect(planShellSearch('rg foo src', 15_000)).toEqual({ timeoutMs: 15_000 });
  expect(planShellSearch('npm run render', 1_800_000)).toEqual({ timeoutMs: 1_800_000 });
});
it("does not extend from echo, complex programs or broad personal folders", () => {
  for (const command of ['echo src/fake.ts; rg foo src', 'rg foo Documents', 'rg foo src; npm run build']) expect(planShellSearch(command).progress).toBeUndefined();
  expect(planShellSearch('rg ";" src').progress?.roots).toEqual(["src"]);
});
it.each(['rg "hello" src', 'find . -name "*.ts" | head', 'grep -r "a;b" src'])('bounds an ordinary read search: %s', command => {
  expect(shellCommandTimeoutMs(command)).toBe(45_000);
});
it.each(['npm run build', 'find . -delete', 'find . -exec rm {} \\;', 'rg foo .; npm install', 'echo "find ."; sleep 300', 'rg --pre=custom foo .', 'rg foo . > results.txt', 'rg "$(side_effect)" .'])('does not misclassify a build, mutation or compound program: %s', command => {
  expect(isBoundedSearchCommand(command)).toBe(false);
  expect(shellCommandTimeoutMs(command, 600_000)).toBe(600_000);
});
it("does not grant native durable commands an implicit hour", () => {
  vi.stubEnv("SANDBOX_COMMAND_TIMEOUT_MS", "300000");
  try { expect(shellCommandTimeoutMs("npm run build")).toBe(300_000); }
  finally { vi.unstubAllEnvs(); }
});
