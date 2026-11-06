// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { androidChatReady, takeAndroidShortcut } from "../../lib/android-host";
import { useAndroidShortcut } from "./use-android-shortcut";
vi.mock("../../lib/android-host",()=>({androidChatReady:vi.fn(),takeAndroidShortcut:vi.fn(()=>false)}));
it("keeps native chat ownership through query changes and uses the current setter",()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const root=createRoot(document.createElement("div"));
 const first=vi.fn(),second=vi.fn();
 function Harness({setter}:{setter:typeof first}){useAndroidShortcut(setter);return null;}
 act(()=>root.render(<Harness setter={first}/>));vi.mocked(androidChatReady).mockClear();
 act(()=>root.render(<Harness setter={second}/>));expect(androidChatReady).not.toHaveBeenCalled();
 vi.mocked(takeAndroidShortcut).mockReturnValueOnce(true);
 act(()=>window.dispatchEvent(new Event("mycellios:dictate")));
 expect(first).not.toHaveBeenCalled();expect(second).toHaveBeenCalledOnce();
 act(()=>root.unmount());expect(androidChatReady).toHaveBeenCalledWith(false);
 vi.unstubAllGlobals();
});
