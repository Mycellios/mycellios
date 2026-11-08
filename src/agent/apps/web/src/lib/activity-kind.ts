/** Classify reported tool activity. Never display commands, paths or generated narration as status. */
export function activityKind(value: string) {
  const text = value.toLowerCase();
  if (/\b(search[_ ]history|search[_ ]memory|history[_ ]search)\b/.test(text)) return "history";
  if (/\b(task[_ ]catalog|scratchpad|work[_ ]status)\b/.test(text)) return "planning";
  if (/(?:^|[_\s-])calendar(?:$|[_\s-])/.test(text)) return "calendar";
  if (/(?:^|[_\s-])(?:mail|email|inbox)(?:$|[_\s-])/.test(text)) return "mail";
  if (/\b(vitest|pytest|jest|run tests|npm (?:run )?test|node --test|dotnet test)\b/.test(text)) return "tests";
  if (/\b(git (?:status|diff|log)|review changes)\b/.test(text)) return "changes";
  if (/\b(apply[_ -]?patch|write[_ -]?file|edit[_ -]?file|set-content|editing)\b/.test(text)) return "editing";
  if (/\b(rg|findstr|get-childitem|get-content|get-location|test-path|read[_ -]?file|list[_ -]?files|read files|list files|search files)\b/.test(text)) return "files";
  if (/\b(web[_ -]?search|searching the web|browse|fetch url)\b/.test(text)) return "web";
  if (/\b(ssh|server)\b/.test(text)) return "server";
  if (/\b(generate[_ -]?image|image[_ -]?generate|imagegen)\b/.test(text)) return "image";
  if (/\b(schedule|routine)[_ -]/.test(text)) return "schedule";
  if (/\b(send[_ -]?message|delegate|message bot)\b/.test(text)) return "message";
  if (/\b(npm run build|compil|building|tsc|typecheck)/.test(text)) return "build";
  if (/^running:|\b(shell|run command|execute command)\b/.test(text)) return "command";
  return "tool";
}
