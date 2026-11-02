// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import {createRoot} from "react-dom/client";
import {beforeEach,expect,it,vi} from "vitest";
const{setLocale}=vi.hoisted(()=>({setLocale:vi.fn(async(locale:string)=>locale)}));
vi.mock("../lib/i18n",()=>({getActiveUiLocale:()=>"es",setUiLocale:setLocale}));
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray)=>s.join("")}),Trans:({children}:{children:ReactNode})=>children}));
vi.mock("./AuthMushroom",()=>({AuthMushroom:()=>null}));
import { LanguageEntry } from "./LanguageEntry";
import {LANGUAGE_ENTRY_KEY} from "../lib/language-entry";
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();setLocale.mockReset().mockImplementation(async(locale:string)=>locale);});
it("keeps the app unmounted until language confirmation, then remembers it",async()=>{
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<LanguageEntry><span>Private application</span></LanguageEntry>));expect(el.textContent).not.toContain("Private application");expect(el.querySelector('[role="combobox"]')?.textContent).toContain("Español");
 await act(async()=>el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());expect(setLocale).toHaveBeenCalledWith("es");expect(localStorage.getItem(LANGUAGE_ENTRY_KEY)).toBe("es");expect(el.textContent).toContain("Private application");}
 finally{await act(async()=>root.unmount());el.remove();}
});
it("does not ask again once a valid choice has been confirmed",async()=>{
 localStorage.setItem(LANGUAGE_ENTRY_KEY,"fr");const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<LanguageEntry>Private application</LanguageEntry>));expect(el.querySelector("select")).toBeNull();expect(el.textContent).toContain("Private application");expect(setLocale).not.toHaveBeenCalled();}
 finally{await act(async()=>root.unmount());}
});
it("keeps language selection visible if the requested catalog fails",async()=>{
 setLocale.mockResolvedValue("en");const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<LanguageEntry>Private application</LanguageEntry>));await act(async()=>el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());expect(el.querySelector('[role="alert"]')).not.toBeNull();expect(localStorage.getItem(LANGUAGE_ENTRY_KEY)).toBeNull();expect(el.textContent).not.toContain("Private application");}
 finally{await act(async()=>root.unmount());}
});
