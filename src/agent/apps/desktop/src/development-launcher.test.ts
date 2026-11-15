import {describe,expect,it} from "vitest";
import {developmentChat} from "./development-launcher.js";

describe("native developer chat admission",()=>{
  it("admits only the currently open main chat",()=>{
    expect(developmentChat("https://www.mycellios.com/agent/app/mico-1","mico-1")).toBe("mico-1");
    expect(developmentChat("http://127.0.0.1:5192/app/mico-1?view=chat","mico-1")).toBe("mico-1");
  });
  it.each(["https://www.mycellios.com/agent/app/other","https://www.mycellios.com/agent/app/mico-1?task=task","https://www.mycellios.com/agent/app/mico-1?task=","https://www.mycellios.com/agent/app/mico-1?project=project"])("rejects another chat/project context: %s",url=>{
    expect(()=>developmentChat(url,"mico-1")).toThrow();
  });
  it.each([null,{},"../source","",Array(300).fill("x").join("")])("never accepts a renderer-supplied path or command: %s",id=>{
    expect(()=>developmentChat("https://www.mycellios.com/agent/app/mico-1",id)).toThrow();
  });
});
