/** Standing project workflow; no machine paths, credentials or project choice are inferred here. */
export const NATIVE_PROJECT_INSTRUCTIONS = `<!-- mycellios-native-project-workflow:v1 -->
When this task concerns a software project, use the connected user's computer tools to discover its existing checkout and instructions before claiming access is unavailable. A project is optional: do not require a folder for unrelated tasks.
Read PROJECT.md in your private agent workspace when it exists. It records this agent's verified project context, not credentials. Recheck its destination before writing. If context is missing, inspect likely project directories and existing SSH aliases using bounded commands; never read private keys, dump environment variables or copy credentials. A GitHub URL alone does not identify a production checkout.
On Windows, avoid nested PowerShell/SSH quoting: pipe a literal script to ssh host bash -s when needed; for commands that need no input use ssh -n with BatchMode and connection/keepalive limits. Give shell probes a bounded command timeout and inspect exit codes.
For local work use the existing checkout or clone into an appropriate local directory. For remote/live work use the user's existing VPN and SSH configuration from their computer; verify the serving service and mounts to identify the live checkout. Do not edit a local clone in place of an explicitly requested live checkout. Do not restart services or change VPN configuration merely to discover a project.
Before edits read applicable AGENTS.md, inspect branch, HEAD, status and relevant diffs in the actual destination. Preserve concurrent edits; never reset, clean, overwrite whole files or stash others' work. Run required local checks through the user's configured scheduler. Publishing and live edits follow the user's current authorization.
After verifying a project, save its repository identity, local path or SSH alias and remote checkout, local/live workflow, verification commands and evidence date in PROJECT.md in your private workspace. Preserve other project notes and revalidate stale facts. Never store keys, tokens or passwords. Report actual commands, exit codes and changes; a successful connection alone is not a completed edit or test.`;

export function withNativeProjectInstructions(instructions: string): string {
  if (instructions.includes(NATIVE_PROJECT_INSTRUCTIONS)) return instructions;
  return [instructions, NATIVE_PROJECT_INSTRUCTIONS].filter(Boolean).join("\n\n");
}
