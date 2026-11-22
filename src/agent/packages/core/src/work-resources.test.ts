import { describe, expect, it } from "vitest";
import { nativeWorkProjectSession, normalizeWorkResources, taskThreadKind, workResourcesConflict } from "./work-resources.js";
describe("Mico side thread kinds", () => {
  it("names what started each thread from its server-owned keys", () => {
    const kind = (projectKey: string, taskKey: string) => taskThreadKind({ taskBotId: "mico", projectKey, taskKey });
    expect(kind("mico:mico", "mico-task:mico:one")).toBe("conversation");
    expect(kind("mico:mico", "mico-task:mico:inbox:nonce")).toBe("conversation");
    expect(kind("routine:r1", "routine:r1")).toBe("routine");
    expect(kind("routine:r1", "mico-task:mico:legacy")).toBe("routine");
    expect(kind("workflow:flow", "workflow:execution:mico")).toBe("workflow");
    expect(kind("work:root", "delegation:key")).toBe("delegation");
    expect(kind("routine:r1", "delegation:key")).toBe("delegation");
    expect(kind("work:root", "work-transfer:task:1")).toBe("delegation");
    expect(kind("project:one", "project-task:login")).toBe("project");
    expect(kind("mico:other", "mico-task:mico:one")).toBe("other");
    expect(kind("app-cover:app", "cover")).toBe("other");
  });
});
describe("work resource reservations", () => {
  it("retains native project admission for ordinary task chats and reuses workspaces only for structured internal work", () => {
    const thread={id:"thread",taskBotId:"mico",projectKey:"project",taskKey:"task"};
    expect(nativeWorkProjectSession(thread,{})).toBe("thread");
    expect(nativeWorkProjectSession(thread,{delegationState:"running"})).toBe("thread");
    const internal={...thread,projectKey:"work:root",taskKey:"delegation:effect"};
    expect(nativeWorkProjectSession(internal,{})).toBe("thread");
    expect(nativeWorkProjectSession(internal,{delegationState:"running"})).toBeUndefined();
    expect(nativeWorkProjectSession({...internal,taskKey:"work-transfer:task:1"},{delegationState:"running"})).toBeUndefined();
    expect(nativeWorkProjectSession({...thread,taskBotId:null},{})).toBeUndefined();
    expect(nativeWorkProjectSession({...thread,projectKey:"mico:mico",taskKey:"mico-task:mico:one"},{})).toBeUndefined();
    expect(nativeWorkProjectSession({...thread,projectKey:"mico:other",taskKey:"mico-task:mico:one"},{})).toBe("thread");
    expect(nativeWorkProjectSession({...thread,projectKey:"mico:mico",taskKey:"project-task"},{})).toBe("thread");
  });
  it("detects Windows aliases and ancestor paths without conflicting siblings", () => {
    const parent = normalizeWorkResources(["workspace:C:\\Projects\\App\\"]);
    expect(parent).toEqual(["workspace:c:/projects/app"]);
    expect(workResourcesConflict(parent, normalizeWorkResources(["workspace:c:/projects/app/src"]))).toBe(true);
    expect(workResourcesConflict(parent, normalizeWorkResources(["workspace:c:/projects/application"]))).toBe(false);
    expect(workResourcesConflict(["host"], parent)).toBe(true);
    expect(workResourcesConflict(["browser"], parent)).toBe(false);
  });
  it("reserves hosted app files so team members can edit different files at once", () => {
    const page = normalizeWorkResources(["site:index.html"]);
    expect(page).toEqual(["site:index.html"]);
    expect(workResourcesConflict(page, normalizeWorkResources(["site:styles.css"]))).toBe(false);
    expect(workResourcesConflict(page, normalizeWorkResources(["site:index.html"]))).toBe(true);
    expect(workResourcesConflict(normalizeWorkResources(["site:assets/"]), normalizeWorkResources(["site:assets/logo.svg"]))).toBe(true);
    expect(workResourcesConflict(normalizeWorkResources(["site:app"]), normalizeWorkResources(["site:app.js"]))).toBe(false);
    expect(workResourcesConflict(normalizeWorkResources(["site:c"]), normalizeWorkResources(["workspace:/c"]))).toBe(false);
    expect(workResourcesConflict(["host"], page)).toBe(true);
  });
  it("rejects relative paths, traversal and oversized resource requests", () => {
    for (const input of [["workspace:relative"], ["workspace:C:/app/../other"], ["unknown"], Array(17).fill("host"),
      ["site:"], ["site:/index.html"], ["site:../secret"], ["site:a//b"], ["site:a b.html"], ["site:" + "a".repeat(513)]])
      expect(() => normalizeWorkResources(input)).toThrow();
  });
});
