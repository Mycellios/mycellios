import { expect, it, vi } from "vitest";
import { nativePreviewContext } from "./project-session.js";
it("reads only bounded non-secret owner and Space identifiers from the native app frame",async()=>{
  const read=vi.fn(async()=>["user-a","space-a"]);
  const win={webContents:{executeJavaScript:read}} as any;
  await expect(nativePreviewContext(win)).resolves.toEqual(["user-a","space-a"]);
  for(const value of [["user-b","space-a"],[null,null]]){
    read.mockResolvedValue(value as any);await expect(nativePreviewContext(win)).resolves.toEqual(value);
  }
  for(const value of [["user", "x".repeat(257)],["user\nother","space"],{},["owner"],[false,null]]){
    read.mockResolvedValue(value as any);await expect(nativePreviewContext(win)).rejects.toThrow("Invalid preview owner context");
  }
});
