/** Shared by the gateway reservation overlay. Prices are exact USD per million
 * with six decimals; round catalog rates UP before creating these bounds. */
export const CONTRACT = 'token-bounded-v2';
const bounds = new WeakMap();
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function priceMicros(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(value)) throw new Error('invalid_token_price_bound');
  const [whole, fraction=''] = value.split('.');
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6,'0'));
  if (result > 1_000_000_000_000n) throw new Error('invalid_token_price_bound');
  return result;
}
export function boundedTextRequest(path, model, input) {
  if (path !== '/v1/chat/completions' || !record(input) || typeof model !== 'string') return null;
  const supplied = input.mycellios_cost_bounds;
  const legacy = /^(?:[a-f0-9]{40}@)?deepseek-v4-flash$/.test(model);
  if (supplied === undefined && !legacy) return null;
  if (supplied !== undefined && (!record(supplied) || Object.keys(supplied).sort().join(',') !== 'input,output,version' || supplied.version !== 2 || !/^[a-f0-9]{40}@[A-Za-z0-9._:/-]{1,180}$/.test(model))) throw new Error('invalid_cost_contract');
  if(input.model!==model)throw new Error('cost_contract_model_mismatch');
  const inputPrice = supplied?.input ?? '0.5', outputPrice = supplied?.output ?? '1';
  priceMicros(inputPrice);priceMicros(outputPrice);
  const allowed = new Set(['model','messages','max_tokens','max_completion_tokens','stream','stream_options','store','temperature','top_p','stop','tools','tool_choice','parallel_tool_calls','response_format','mycellios_cost_bounds']);
  if(Object.keys(input).some(key=>!allowed.has(key)) || input.store !== undefined && input.store !== false)throw new Error('unsupported_text_cost_field');
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 256 || !input.messages.every(m => record(m) && ['system','developer','user','assistant','tool'].includes(m.role) && (m.content == null || typeof m.content === 'string'))) throw new Error('bounded_text_messages_required');
  if(input.messages.some(m=>Object.keys(m).some(key=>!['role','content','name','tool_calls','tool_call_id'].includes(key))))throw new Error('unsupported_text_message_field');
  if(input.tools!==undefined && (!Array.isArray(input.tools)||input.tools.length>128||input.tools.some(t=>!record(t)||t.type!=='function'||!record(t.function)||typeof t.function.name!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(t.function.name))))throw new Error('unsupported_server_tool');
  const limits=[input.max_tokens,input.max_completion_tokens].filter(v=>v!==undefined);
  if(limits.some(v=>!Number.isSafeInteger(v)||v<1||v>8192))throw new Error('invalid_output_bound');
  const output=limits.length?Math.max(...limits):4096;
  const request={...input,max_tokens:output};delete request.mycellios_cost_bounds;
  if(input.max_completion_tokens!==undefined)request.max_completion_tokens=output;
  const bytes=Buffer.byteLength(JSON.stringify(request));
  if(bytes>131072)throw new Error('bounded_text_request_too_large');
  bounds.set(request,{input:inputPrice,output:outputPrice});
  return request;
}
export function requestPriceBounds(request) {
  const value=bounds.get(request);
  if(!value)throw new Error('unverified_cost_contract');
  return value;
}
export function tokenPolicyCaps(request) {
  const value=requestPriceBounds(request);
  return {maxInputUsdPerMillion:Number(priceMicros(value.input))/1e6,maxCachedInputUsdPerMillion:Number(priceMicros(value.input))/1e6,maxOutputUsdPerMillion:Number(priceMicros(value.output))/1e6};
}
export function boundedHoldUsdc(body,request) {
  const value=requestPriceBounds(request);
  const input=BigInt(body.length+8192+request.messages.length*64),output=BigInt(request.max_tokens);
  const hold=(input*priceMicros(value.input)+output*priceMicros(value.output)+999_999n)/1_000_000n;
  if(hold>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('unbounded_request_cost');
  return Number(hold);
}
