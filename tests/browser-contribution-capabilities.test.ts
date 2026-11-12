import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { mountBrowserInference } from "../src/coordinator/browser-inference-routes.js";
import type { BrowserInference } from "../src/coordinator/browser-inference.js";
it.each([0,1])("publishes public readiness without leaking identity or granting payout ownership (%s offers)",async count=>{
  const app=Fastify();const bind=vi.fn();
  mountBrowserInference(app,{models:()=>Array.from({length:count},()=>({id:"fixture"})),bind,recoverExpired:async()=>{}} as unknown as BrowserInference,
    ()=>({kind:"api_key",userId:"fixture-user"}));
  try {
    const status=await app.inject({method:"GET",url:"/mobile/v1/contribution-capabilities"});
    expect(status.statusCode).toBe(200);expect(status.headers["cache-control"]).toBe("no-store");
    expect(status.json()).toEqual({schema:"mycellios-browser-contribution/1",accountLinking:true,paidInference:count>0});
    const denied=await app.inject({method:"POST",url:"/v1/browser/contributors",payload:{workerId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",token:"x".repeat(32)}});
    expect(denied.statusCode).toBe(403);expect(bind).not.toHaveBeenCalled();
  }finally{await app.close();}
});
