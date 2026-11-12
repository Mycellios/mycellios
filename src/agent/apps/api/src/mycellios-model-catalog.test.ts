import { describe, expect, it, vi } from "vitest";
import { readMycelliosChatModels } from "./mycellios-model-catalog.js";

describe("Mycellios account chat catalog", () => {
  it("shows zero Credits only for all-zero prices, keeps fixed fees visible and excludes unqualified services",async()=>{
    const pricing={currency:"credits",unit:"token",serviceFeeBasisPoints:400,input:"0",output:"0",request:"0"};
    const entries=await readMycelliosChatModels("fixture",{fetch:vi.fn(async()=>Response.json({data:[
      {id:"mycellios/managed/vendor/free",modality:"text",processing:"external",pricing},
      {id:"mycellios/managed/vendor/request",modality:"text",processing:"external",pricing:{...pricing,request:"0.21944"}},
      {id:"mycellios/managed/vendor/unqualified",modality:"text",processing:"external",pricing,available:false},
      {id:"mycellios/managed/vendor/embedding",modality:"embeddings",processing:"external",pricing},
    ]}))});
    expect(entries).toHaveLength(2);expect(entries[0]?.billing).toContain("0 Credits");
    expect(entries[1]?.billing).toContain("0.21944 Credits / request");expect(entries[1]?.billing).not.toContain("0 Credits");
    expect(entries[1]?.mycelliosPricing?.request).toBe("0.21944");
  });
  it("shows the full combined catalog under Mycellios and trusts explicit chat metadata instead of name guesses",async()=>{
    const pricing={currency:"credits",unit:"token",serviceFeeBasisPoints:400,input:"0.00000104",output:"0.00000208"};
    const rows=Array.from({length:160},(_,i)=>({id:`mycellios/managed/vendor/model-${i}`,name:`Model ${i}`,modality:"text",processing:"external",task:"chat",pricing}));
    const entries=await readMycelliosChatModels("fixture",{credentialId:"owned",fetch:vi.fn(async()=>Response.json({data:[
      {id:"native-chat",processing:"network",x_replicas:1,x_pipelines:0},...rows,
      {id:"mycellios/managed/vendor/audio-research",name:"Research",modality:"text",processing:"external",task:"chat",pricing},
      {id:"mycellios/managed/vendor/mixed",modality:"image",processing:"external",task:"chat",pricing},
    ]}))});
    expect(entries).toHaveLength(162);expect(entries.every(m=>m.providerName==="Mycellios")).toBe(true);
    expect(entries.some(m=>m.label==="Research")).toBe(true);expect(entries.some(m=>m.id.endsWith("/mixed"))).toBe(false);
    expect(entries.every(m=>m.credentialIds?.includes("owned"))).toBe(true);
  });
  it("lists live chat models under Credit funding without inference or credential creation", async () => {
    const transport = vi.fn(async () =>
      Response.json({
        data: [
          { id: "qwen3-8b", name: "Qwen3 8B", recommended: true, x_replicas: 0, x_pipelines: 1 },
          { id: "qwen3-8b" },
          { id: "qwen3-14b", available: false },
          { id: "qwen3-32b", creditEligible: false },
          { id: "qwen3-4b", x_replicas: 0, x_pipelines: 0 },
          { id: "qwen3-embedding-4b" },
          { id: "kokoro" },
            { id: "mycellios-whisper-small", task: "transcription" },
          { id: "ltx-video" },
          { id: "unrelated", task: "speech" },
        ],
      }),
    );
    const result = await readMycelliosChatModels("account-key", {
      fetch: transport,
      credentialId: "owned",
    });
    expect(result).toEqual([
      {
        provider: "openai-compatible",
        providerName: "Mycellios",
        id: "qwen3-8b",
        label: "Qwen3 8B",
        live: true,
        billing: "Uses your Mycellios credits",
        recommended: true,
        credentialIds: ["owned"],
      },
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://www.mycellios.com/v1/models");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(new Headers(init.headers).get("x-mycellios-funding")).toBe("contribution-credits");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer account-key");
  });
  it.each([401, 403, 429, 503])("fails closed for an unavailable catalog (%s)", async (status) => {
    await expect(
      readMycelliosChatModels("private", {
        fetch: vi.fn(async () => new Response("private upstream", { status })),
      }),
    ).rejects.toThrow("temporarily unavailable");
  });
  it("accepts an empty catalog without inventing a default", async () => {
    expect(
      await readMycelliosChatModels("key", {
        fetch: vi.fn(async () => Response.json({ data: [] })),
      }),
    ).toEqual([]);
  });
  it("shows managed models as Mycellios with final prices, while preserving external processing", async () => {
    const pricing = { currency: "credits", unit: "token", serviceFeeBasisPoints: 400, input: "0.00000104", output: "0.00000208" };
    const entries = await readMycelliosChatModels("account", { fetch: vi.fn(async () => Response.json({ data: [
      { id: "mycellios/managed/vendor/text", name: "Text model", processing: "external", pricing, x_replicas: 0, x_pipelines: 0 },
      { id: "mycellios/managed/vendor/unpriced", processing: "external" },
      { id: "mycellios/managed/vendor/video", processing: "external", pricing, task: "video" },
    ] })) });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ providerName: "Mycellios", label: "Text model", mycelliosProcessing: "external", mycelliosPricing: pricing,
      billing: "Credits / 1M tokens · Input 1.04 · Output 2.08 · 4% included" });
    expect(JSON.stringify(entries)).not.toContain("OpenRouter");
  });
  it("never rounds a nonzero managed catalog price down to free", async () => {
    const entries = await readMycelliosChatModels("account", { fetch: vi.fn(async () => Response.json({ data: [
      { id: "mycellios/managed/vendor/tiny", processing: "external", pricing: {
        currency: "credits", unit: "token", serviceFeeBasisPoints: 400, input: "0.000000000000000001", output: "0" } },
    ] })) });
    expect(entries[0]?.billing).toContain("Input 0.000000000001");
  });
  it("shows a native price bound without applying the external service markup", async () => {
    const entries = await readMycelliosChatModels("account", { fetch: vi.fn(async () => Response.json({ data: [
      { id: "native-text", processing: "network", x_replicas: 1, x_pipelines: 0, pricing: {
        currency: "credits", unit: "token", estimate: "maximum", serviceFeeBasisPoints: 0, input: "0.000001", output: "0.000002" } },
    ] })) });
    expect(entries[0]).toMatchObject({ mycelliosProcessing: "network", billing: "Credits / 1M tokens · Input up to 1 · Output up to 2" });
    expect(entries[0]?.billing).not.toContain("4%");
  });
});
