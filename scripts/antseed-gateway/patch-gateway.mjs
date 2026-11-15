import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function patchGatewayServer(source, protectedKeyIds) {
  if(!protectedKeyIds.length||protectedKeyIds.some(v=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(v)))throw new Error('protected_key_ids_required');
  const replacements=[
    ['const bounded = boundedDeepSeekRequest(route.prefix, model, parsed);','let bounded;\n    try { bounded = boundedDeepSeekRequest(route.prefix, model, parsed); } catch {\n      sendError(res, 400, "invalid_request_error", "invalid_text_cost_contract", "Invalid bounded text request");\n      return;\n    }'],
    ['model, bounded !== null);','model, bounded);'],
    ['model, boundedDeepSeek = false) {',`model, boundedDeepSeek = null) {\n    if (${JSON.stringify(protectedKeyIds)}.includes(key.id) && route.paid && !boundedDeepSeek) {\n      sendError(res, 400, "invalid_request_error", "bounded_text_contract_required", "An enforceable text cost contract is required");\n      return {allowed:false};\n    }`],
    ['deepSeekBudgetPolicy(resolved.policy)','deepSeekBudgetPolicy(resolved.policy, boundedDeepSeek)'],
    ['async _handle(req, res) {','async _handle(req, res) {\n    res.setHeader("x-mycellios-cost-contract", "token-bounded-v2");'],
  ];
  for(const [from,to] of replacements){if(source.split(from).length!==2)throw new Error('gateway_source_mismatch: '+from);source=source.replace(from,to);}
  return source;
}
export const reservationModule=`import {narrowPolicy} from "../routing-policy/policy.js";\nimport * as legacy from "./request-reservation.legacy.js";\nimport {boundedTextRequest,tokenPolicyCaps,boundedHoldUsdc} from "./mycellios-text-cost-contract.mjs";\nconst generic=new WeakSet();\nexport function boundedDeepSeekRequest(path,model,input){if(input?.mycellios_cost_bounds===undefined)return legacy.boundedDeepSeekRequest(path,model,input);const request=boundedTextRequest(path,model,input);if(request)generic.add(request);return request;}\nexport function deepSeekBudgetPolicy(policy,request){return generic.has(request)?narrowPolicy(policy,tokenPolicyCaps(request)):legacy.deepSeekBudgetPolicy(policy);}\nexport function deepSeekHoldUsdc(body,request,policy){return generic.has(request)?boundedHoldUsdc(body,request):legacy.deepSeekHoldUsdc(body,request,policy);}\n`;
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output,keys]=process.argv.slice(2);
  const source=await readFile(input,'utf8');
  const patched=patchGatewayServer(source,JSON.parse(keys));
  await writeFile(output,patched);
  await writeFile(output+'.reservation',reservationModule);
  console.log(JSON.stringify({sha256:createHash('sha256').update(patched).digest('hex')}));
}
