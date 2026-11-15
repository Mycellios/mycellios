/** Local, deterministic lexical ranking. No embeddings, model call or external service. */
const STOP = new Set("a al algo and con como de del el ella en es esta este for how la las lo los me mi my para por que qué se su the to un una y yo you".split(" "));
export function memoryTerms(text: string, maximum=80): string[] {
 return [...new Set(text.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? [])].filter(x=>!STOP.has(x)).slice(0,maximum);
}
export function rankLocalMemories<T extends {path:string;content:string;updatedAt?:string|Date}>(documents:T[],query:string):Array<{document:T;score:number}> {
 const terms=memoryTerms(query);if(!terms.length)return [];
 const rows=documents.map(document=>({document,terms:memoryTerms(document.path+" "+document.content,32000),title:memoryTerms(document.path)}));
 return rows.map(row=>({document:row.document,score:terms.reduce((score,term)=>{
  const matches=(words:string[])=>words.some(w=>w===term||(term.length>=6&&w.startsWith(term.slice(0,-2))));
  if(!matches(row.terms))return score;
  const frequency=rows.filter(other=>matches(other.terms)).length;
  return score+(1+Math.log(1+rows.length/(1+frequency)))*(matches(row.title)?3:1);
 },0)})).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||Date.parse(String(b.document.updatedAt??""))-Date.parse(String(a.document.updatedAt??""))||a.document.path.localeCompare(b.document.path));
}
export function localMemorySnippet(content:string,query:string,maximum=1600):string {
 if(content.length<=maximum)return content;
 const terms=memoryTerms(query);const paragraphs=content.split(/\n\s*\n/);const ranked=rankLocalMemories(paragraphs.map((text,index)=>({path:String(index),content:text})),query);
 const selected=ranked[0]?.document.content??content;
 const normalized=selected.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const first=terms.map(term=>normalized.indexOf(term)).filter(i=>i>=0).sort((a,b)=>a-b)[0]??0;
 const start=Math.max(0,first-Math.floor(maximum/4));return (start?"…":"")+selected.slice(start,start+maximum)+(selected.length>start+maximum?"…":"");
}
