// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from "vitest";
import{getResponseCostVisible,setResponseCostVisible,subscribeResponseCost}from"./response-cost-preference";
beforeEach(()=>{localStorage.clear();const off=subscribeResponseCost(()=>undefined);window.dispatchEvent(new StorageEvent("storage",{key:null}));off();});
it("starts hidden and saves an explicit choice",()=>{
 expect(getResponseCostVisible()).toBe(false);setResponseCostVisible(true);expect(getResponseCostVisible()).toBe(true);expect(localStorage.getItem("mycellios.showResponseCost")).toBe("on");
 setResponseCostVisible(false);expect(getResponseCostVisible()).toBe(false);
});
it("updates subscribers immediately and responds to other tabs",()=>{
 const changed=vi.fn();const off=subscribeResponseCost(changed);setResponseCostVisible(true);expect(changed).toHaveBeenCalledTimes(1);
 localStorage.setItem("mycellios.showResponseCost","off");window.dispatchEvent(new StorageEvent("storage",{key:"mycellios.showResponseCost"}));expect(getResponseCostVisible()).toBe(false);expect(changed).toHaveBeenCalledTimes(2);off();
});
it("keeps the in-memory switch usable when persistence fails",()=>{
 const spy=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
 try{expect(()=>setResponseCostVisible(true)).not.toThrow();expect(getResponseCostVisible()).toBe(true);}finally{spy.mockRestore();}
});
