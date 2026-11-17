import { expect, it, vi } from "vitest";
import { isBoundedSearchCommand, shellCommandTimeoutMs } from "./shell-command-budget.js";
it("caps the exact wide home search that left Videos waiting, including a larger requested budget", () => {
  const command = 'cd ~ && find . -maxdepth 6 -iname "voice.json" 2>/dev/null | head; echo "=== grep"; grep -rl "AndorraExplicatiu" --include="*.tsx" . 2>/dev/null | head -5; ls -la ~/bots/*/artifacts 2>/dev/null | head';
  expect(isBoundedSearchCommand(command)).toBe(true);
  expect(shellCommandTimeoutMs(command, 3_600_000)).toBe(45_000);
  expect(shellCommandTimeoutMs(command, 15_000)).toBe(15_000);
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
