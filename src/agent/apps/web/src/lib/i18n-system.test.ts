// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateUiLocale, setCatalogLoadersForTests, setUiLocale, syncSystemUiLocale } from "./i18n";
import { UI_LOCALES, UI_LOCALE_STORAGE_KEY, type UiLocale } from "./ui-locale";

let store: Map<string,string>;
const device=(language:string)=>vi.stubGlobal("navigator",{language,languages:[language]});
function catalogs(failing?: UiLocale) {
  const loaders={} as Record<UiLocale,()=>Promise<{messages:Record<string,string>}>>;
  for(const locale of UI_LOCALES) loaders[locale]=async()=>{
    if(locale===failing)throw Error("missing");
    return {messages:{Settings:locale}};
  };
  return loaders;
}
beforeEach(()=>{
  store=new Map();
  vi.stubGlobal("localStorage",{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)});
  setCatalogLoadersForTests(catalogs());
});
afterEach(()=>{setCatalogLoadersForTests(null);vi.unstubAllGlobals();});

it("follows device changes while retaining the automatic preference",async()=>{
  device("es-ES");
  expect(await setUiLocale("system")).toBe("es");
  expect(store.get(UI_LOCALE_STORAGE_KEY)).toBe("system");
  device("fr-FR");
  expect(await syncSystemUiLocale()).toBe("fr");
  expect(store.get(UI_LOCALE_STORAGE_KEY)).toBe("system");
});

it("never replaces a manual choice on device language changes",async()=>{
  device("es-ES");await setUiLocale("system");await setUiLocale("de");
  device("fr-FR");
  expect(await syncSystemUiLocale()).toBe("de");
  expect(store.get(UI_LOCALE_STORAGE_KEY)).toBe("de");
});

it("respects a saved manual preference before any change in this session",async()=>{
  store.set(UI_LOCALE_STORAGE_KEY,"ja");await activateUiLocale("ja");device("fr-FR");
  expect(await syncSystemUiLocale()).toBe("ja");
});

it("keeps automatic mode when a detected catalog fails",async()=>{
  setCatalogLoadersForTests(catalogs("fr"));device("fr-FR");
  expect(await setUiLocale("system")).toBe("en");
  expect(store.get(UI_LOCALE_STORAGE_KEY)).toBe("system");
});
