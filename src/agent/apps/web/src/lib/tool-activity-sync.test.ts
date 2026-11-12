// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
beforeEach(()=>{vi.resetModules();localStorage.clear();});
afterEach(()=>vi.unstubAllGlobals());

it("keeps legacy-hidden and new turns inspectable but folded",async()=>{
  const p=await import("./tool-activity-preference");
  expect(p.getToolActivityEnabled()).toBe(true);
  expect(p.getToolActivityExpanded()).toBe(false);
  localStorage.setItem(p.TOOL_ACTIVITY_STORAGE_KEY,"off");
  expect(p.getToolActivityPreference()).toBe("on");
  expect(p.getToolActivityEnabled()).toBe(true);
});

it("notifies this page and other windows without retaining an older saved value",async()=>{
  const p=await import("./tool-activity-preference");
  const changed=vi.fn();const stop=p.subscribeToolActivity(changed);
  p.setToolActivityPreference("expanded");
  expect(p.getToolActivityExpanded()).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
  localStorage.setItem(p.TOOL_ACTIVITY_STORAGE_KEY,"on");
  window.dispatchEvent(new StorageEvent("storage",{key:p.TOOL_ACTIVITY_STORAGE_KEY,storageArea:localStorage}));
  expect(changed).toHaveBeenCalledTimes(2);
  expect(p.getToolActivityExpanded()).toBe(false);
  window.dispatchEvent(new StorageEvent("storage",{key:"other",storageArea:localStorage}));
  expect(changed).toHaveBeenCalledTimes(2);
  stop();window.dispatchEvent(new StorageEvent("storage",{key:null}));
  expect(changed).toHaveBeenCalledTimes(2);
});

it("keeps the selected default in memory when storage is blocked",async()=>{
  vi.stubGlobal("localStorage",{getItem:()=>{throw Error("blocked");},setItem:()=>{throw Error("blocked");}});
  const p=await import("./tool-activity-preference");
  p.setToolActivityPreference("expanded");expect(p.getToolActivityExpanded()).toBe(true);
  p.setToolActivityPreference("on");expect(p.getToolActivityExpanded()).toBe(false);
  expect(p.getToolActivityEnabled()).toBe(true);
});
