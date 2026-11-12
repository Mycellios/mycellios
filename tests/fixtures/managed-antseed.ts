import { vi } from "vitest";

export const operatorSecret = "operator-fixture-control-secret-only";
export const seller = "a".repeat(64);
export function antseedFixture(options: {late?:boolean;free?:boolean} = {}) {
  const model = {id:"deepseek-test",name:"DeepSeek test",type:"text",peers:[{
    peerId:seller,provider:"local-llm",serviceId:"deepseek-test",type:"text",protocols:["openai-chat-completions"],
    inputUsdPerMillion:options.free?0:1,outputUsdPerMillion:options.free?0:200,cachedInputUsdPerMillion:0,
    capabilities:{inputs:["text"],outputs:["text"],contextWindow:131072,maxOutputTokens:8192},
  }]};
  let sent:{tag:string;requestId:string}|undefined;
  let ready=!options.late;
  const events = () => sent && ready && !options.free ? [{seq:1,tag:sent.tag,requestId:sent.requestId,
    sellerPeerId:seller,buyerIdentity:"default",amountUsdc:"403",inputTokens:"3",cachedInputTokens:"0",outputTokens:"2",outputImages:"0"}] : [];
  const feed = (after:number) => ({bootId:"test-feed",cursor:sent&&ready&&!options.free?1:0,oldestSeq:1,events:after===0?events():[]});
  const transport=vi.fn<typeof fetch>(async (url, init)=> {
    const path=new URL(String(url));
    if(path.pathname==="/_antseed/attributed-spend")return Response.json(feed(Number(path.searchParams.get("after"))));
    if(path.pathname==="/v1/models")return Response.json({data:[model]});
    if(path.pathname!=="/v1/chat/completions"||init?.method!=="POST")throw new Error("unexpected fixture route");
    const headers=new Headers(init.headers);sent={tag:headers.get("x-antseed-attribution-tag")!,requestId:headers.get("x-antseed-request-id")!};
    const usage={prompt_tokens:3,completion_tokens:2,total_tokens:5};
    if(JSON.parse(String(init.body)).stream) return new Response([
      {id:"chat-test",choices:[{index:0,delta:{content:"Hi"},finish_reason:null}]},
      {id:"chat-test",choices:[{index:0,delta:{},finish_reason:"stop"}]},
      {id:"chat-test",choices:[],usage},
    ].map(v=>`data: ${JSON.stringify(v)}\n\n`).join("")+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}});
    return Response.json({id:"chat-test",choices:[{index:0,message:{role:"assistant",content:"Hi"},finish_reason:"stop"}],usage});
  });
  return {model,transport,feed,events,confirm:()=>{ready=true;},posts:()=>transport.mock.calls.filter(([,i])=>i?.method==="POST")};
}
