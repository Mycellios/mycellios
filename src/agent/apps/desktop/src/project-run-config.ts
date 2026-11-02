import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectRunConfig } from "../../../../contracts/project-runner.js";

const id = /^[a-zA-Z0-9_-]{1,64}$/;
export function localRunUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Invalid local service URL");
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    !url.port ||
    Number(url.port) < 1024
  )
    throw new Error("Service URLs must use loopback HTTP ports above 1023");
  return url.href;
}
export function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function boundedJson(file: string) {
  if ((await stat(file)).size > 65536) throw new Error("Project run configuration is too large");
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) > 65536) throw new Error("Project run configuration is too large");
  return JSON.parse(text);
}
export function validateRunConfig(value: unknown): ProjectRunConfig {
  const config = value as ProjectRunConfig;
  if (
    config?.version !== 1 ||
    !Array.isArray(config.services) ||
    !config.services.length ||
    config.services.length > 12 ||
    !Array.isArray(config.profiles) ||
    !config.profiles.length ||
    config.profiles.length > 12
  )
    throw new Error("Expected version 1 with 1–12 services and profiles");
  const services = new Set<string>();
  const command = (value: unknown) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 8192 &&
    !value.includes("\0");
  for (const service of config.services) {
    if (!service || !id.test(service.id) || services.has(service.id))
      throw new Error("Invalid or duplicate service ID");
    services.add(service.id);
    if (
      !(
        command(service.command) ||
        (service.command &&
          typeof service.command === "object" &&
          command(service.command.win32) &&
          command(service.command.posix))
      )
    )
      throw new Error("Invalid service command");
    if (
      service.cwd !== undefined &&
      (typeof service.cwd !== "string" ||
        service.cwd.length > 4096 ||
        path.posix.isAbsolute(service.cwd) ||
        path.win32.isAbsolute(service.cwd) ||
        service.cwd.replaceAll("\\", "/").split("/").includes(".."))
    )
      throw new Error("Service cwd must stay in the project");
    if (
      service.dependsOn !== undefined &&
      (!Array.isArray(service.dependsOn) ||
        service.dependsOn.length > 12 ||
        service.dependsOn.some((dep) => typeof dep !== "string"))
    )
      throw new Error("Invalid service dependencies");
    if (service.ready) {
      localRunUrl(service.ready.url);
      if (
        service.ready.timeoutMs !== undefined &&
        (!Number.isInteger(service.ready.timeoutMs) ||
          service.ready.timeoutMs < 100 ||
          service.ready.timeoutMs > 120000)
      )
        throw new Error("Invalid service readiness timeout");
    }
    if (
      service.env !== undefined &&
      (!service.env ||
        typeof service.env !== "object" ||
        Array.isArray(service.env) ||
        Object.keys(service.env).length > 64 ||
        Object.entries(service.env).some(
          ([key, value]) =>
            !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
            typeof value !== "string" ||
            value.length > 8192,
        ))
    )
      throw new Error("Invalid service environment");
  }
  const profileIds = new Set<string>();
  for (const profile of config.profiles) {
    if (
      !profile ||
      !id.test(profile.id) ||
      profileIds.has(profile.id) ||
      typeof profile.name !== "string" ||
      !profile.name.trim() ||
      profile.name.length > 80 ||
      !Array.isArray(profile.services) ||
      !profile.services.length ||
      profile.services.length > 12 ||
      profile.services.some((service) => !services.has(service))
    )
      throw new Error("Invalid run profile");
    profileIds.add(profile.id);
    if (profile.url !== undefined) localRunUrl(profile.url);
    serviceOrder(config, profile.id);
  }
  return config;
}
export function serviceOrder(config: ProjectRunConfig, profileId: string) {
  const profile = config.profiles.find((profile) => profile.id === profileId);
  if (!profile) throw new Error("Unknown run profile");
  const ordered: ProjectRunConfig["services"] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Service dependency cycle");
    if (visited.has(id)) return;
    const service = config.services.find((service) => service.id === id);
    if (!service) throw new Error("Unknown service dependency");
    visiting.add(id);
    for (const dependency of service.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(service);
  };
  for (const service of profile.services) visit(service);
  return ordered;
}
export type LoadedProjectRun = {
  root: string;
  config: ProjectRunConfig;
  fingerprint: string;
  preparationId?: string;
};
export async function loadProjectRun(
  workspace: string,
  selected?: string,
  bindingFile?: string,
): Promise<LoadedProjectRun | null> {
  let root = selected ?? workspace,
    preparationId: string | undefined;
  try {
    const binding = await boundedJson(
      bindingFile ?? path.join(workspace, ".mycellios", "project.json"),
    );
    if (
      typeof binding.path !== "string" ||
      !path.isAbsolute(binding.path) ||
      binding.path.length > 4096
    )
      throw new Error("Invalid project path");
    if (!selected || path.resolve(selected) === path.resolve(binding.path)) {
      root = binding.path;
      preparationId = typeof binding.preparationId === "string" ? binding.preparationId : undefined;
    }
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
      throw error;
  }
  try {
    root = await realpath(root);
    const file = path.join(root, ".mycellios", "run.json");
    if (!inside(root, await realpath(file)))
      throw new Error("Run configuration leaves its project");
    const config = validateRunConfig(await boundedJson(file));
    for (const service of config.services) {
      const cwd = await realpath(path.resolve(root, service.cwd ?? "."));
      if (!inside(root, cwd) || !(await stat(cwd)).isDirectory())
        throw new Error("Service directory leaves its project");
    }
    return {
      root,
      config,
      preparationId,
      fingerprint: createHash("sha256")
        .update(JSON.stringify([root, config]))
        .digest("hex"),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
