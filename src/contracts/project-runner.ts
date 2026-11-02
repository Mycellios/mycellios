/** Portable project configuration. Secrets and machine-specific paths do not belong here. */
export interface ProjectRunConfig {
  version: 1;
  services: Array<{
    id: string;
    command: string | { win32: string; posix: string };
    cwd?: string;
    dependsOn?: string[];
    ready?: { url: string; timeoutMs?: number };
    env?: Record<string, string>;
  }>;
  profiles: Array<{ id: string; name: string; services: string[]; url?: string }>;
}

export interface ProjectRunState {
  phase: "idle" | "preparing" | "configured" | "starting" | "running" | "stopped" | "error";
  project?: string;
  profile?: string;
  profiles: Array<{ id: string; name: string }>;
  services: Array<{ id: string; phase: "waiting" | "starting" | "running" | "exited"; owned: boolean }>;
  urls: Array<{ name: string; url: string }>;
  logs: string;
  error?: string;
  preparation?: { id: string; prompt: string };
}

export interface ProjectRunnerBridge {
  state(botId: string): Promise<ProjectRunState>;
  play(request: { botId: string; profile?: string; preparationId?: string }): Promise<ProjectRunState>;
  stop(botId: string): Promise<ProjectRunState>;
}
