import { expect, it } from "vitest";
import { confirmLanguage, hasConfirmedLanguage, LANGUAGE_ENTRY_KEY } from "./language-entry";
it("requires a first choice and recognizes only a supported saved choice",()=>{
 const values=new Map<string,string>();const store={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
 expect(hasConfirmedLanguage(store as Storage)).toBe(false);values.set(LANGUAGE_ENTRY_KEY,"invalid");expect(hasConfirmedLanguage(store as Storage)).toBe(false);
 confirmLanguage("es",store as Storage);expect(hasConfirmedLanguage(store as Storage)).toBe(true);expect(values.get(LANGUAGE_ENTRY_KEY)).toBe("es");
});
it("does not crash when storage is blocked",()=>{
 const store={getItem:()=>{throw new Error("blocked");},setItem:()=>{throw new Error("blocked");}};
 expect(hasConfirmedLanguage(store as unknown as Storage)).toBe(false);expect(()=>confirmLanguage("es",store as unknown as Storage)).not.toThrow();
});
