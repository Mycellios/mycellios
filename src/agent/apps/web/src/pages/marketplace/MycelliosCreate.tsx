import {useEffect,useRef,useState} from "react";
import {Button,Textarea,NativeSelect} from "@rakazo/ui-web";
import {Image, Mic, Video} from "lucide-react";
import {StoreAppHeader} from "./StoreAppHeader";
import "./studio-ia.css";
import {rpc} from "../../lib/rpc";
import {prepareNetworkTranscriptionAudio} from "../../lib/transcription-audio";

type Model={id:string;name:string;modality:"image"|"speech"|"transcription"|"video"|"embeddings"|"rerank"|"batch"|"decisions";maximumCreditsMicrounits:number;voices:string[];durations:number[]};
const names={image:"Imagen",speech:"Voz",transcription:"Transcribir audio",video:"Vídeo",embeddings:"Embeddings",rerank:"Ordenar resultados",batch:"Lote de textos",decisions:"Evaluar un texto"};
const credits=(v:number)=>new Intl.NumberFormat("es",{maximumFractionDigits:6}).format(v/1000000);
type Reply={status?:string;code?:string;response?:any;data?:Model[];maximumMicrounits?:number;token?:string;url?:string;requestId?:string;viewer?:string};
export function MycelliosCreate({onBack}:{onBack:()=>void}) {
 const [models,setModels]=useState<Model[]>([]),[id,setId]=useState(""),[prompt,setPrompt]=useState(""),[audio,setAudio]=useState<{data:string;format:"wav"|"mp3"}>();
 const [quote,setQuote]=useState<Reply>(),[result,setResult]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[pending,setPending]=useState("");
 const [catalogIssue,setCatalogIssue]=useState<""|"disabled"|"connection"|"unavailable">("");
 const [payment,setPayment]=useState(""),[download,setDownload]=useState("");
 const [voice,setVoice]=useState(""),[duration,setDuration]=useState(0),[documents,setDocuments]=useState("");
 const key=useRef(""),checkoutKey=useRef(""),lock=useRef(false),alive=useRef(true),url=useRef("");
 const recoveryKey=useRef("");
 const viewer=useRef("");
 const completedKey=useRef("");
 const model=models.find(m=>m.id===id);
 const call=async(action:"models"|"quote"|"execute"|"status"|"content"|"checkout",payload?:unknown)=>await rpc.models.mycelliosMedia({action,...(action!=="models"?{expectedUserId:viewer.current}:{}),payload:JSON.stringify(payload??{}),...(action==="execute"||action==="checkout"?{key:action==="checkout"?checkoutKey.current:key.current}:{})}) as Reply;
 async function act(work:()=>Promise<void>) {if(lock.current)return;lock.current=true;setBusy(true);setError("");try{await work();}catch(e){if(alive.current)setError(e instanceof Error?e.message:"No se pudo completar. No vuelvas a enviar si ya hay un trabajo en curso.");}finally{lock.current=false;if(alive.current)setBusy(false);}}
 const lines=(value:string)=>value.split("\n").map(v=>v.trim()).filter(Boolean);
 const input=()=>({model:id,kind:model!.modality,...(model!.modality==="transcription"?{audio}:model!.modality==="batch"?{prompts:lines(prompt)}:{prompt}),
  ...(model!.modality==="rerank"?{documents:lines(documents)}:model!.modality==="decisions"?{state:documents}:{}),...(model!.modality==="speech"?{voice}:{}),...(model!.modality==="video"?{duration}:{})});
 function accept(reply:Reply){if(reply.status==="completed"){completedKey.current=key.current;setResult(reply.response);setPending("");if(recoveryKey.current)sessionStorage.removeItem(recoveryKey.current);key.current="";}else if(reply.status==="not_submitted"){setPending("");setQuote(undefined);setError(reply.code==="insufficient_contribution_credits"?"No tienes créditos suficientes. Recarga y vuelve a ver el precio.":"Vuelve a ver el precio para continuar. Conservamos la solicitud para evitar duplicados.");}else setPending(reply.status??"pending_reconciliation");}
 async function loadCatalog(){await act(async()=>{
  setCatalogIssue("");
  let reply:Reply;
  try { reply=await call("models"); }
  catch(e){
   if(alive.current){
    const code=e && typeof e==="object" && "code" in e ? e.code : "";
    setCatalogIssue(code==="PRECONDITION_FAILED"?"disabled":code==="UNAUTHORIZED"?"connection":"unavailable");
   }
   return;
  }
  if(alive.current){setModels(reply.data??[]);setId(reply.data?.[0]?.id??"");if(reply.viewer){viewer.current=reply.viewer;recoveryKey.current="mycellios-create-"+reply.viewer;const saved=sessionStorage.getItem(recoveryKey.current);if(saved&&/^[a-f0-9-]{36}$/.test(saved)){key.current=saved;setPending("pending_reconciliation");}}}
 });}
 useEffect(()=>{alive.current=true;void loadCatalog();return()=>{alive.current=false;if(url.current)URL.revokeObjectURL(url.current);};},[]);
 useEffect(()=>{if(!pending)return;const timer=setInterval(()=>{if(!document.hidden)void act(async()=>{const reply=await call("status",{idempotencyKey:key.current});if(alive.current)accept(reply);});},5000);return()=>clearInterval(timer);},[pending]);
 useEffect(()=>{setQuote(undefined);},[prompt,id,audio,voice,duration,documents]);
 useEffect(()=>{setVoice(model?.voices[0]??"");setDuration(model?.durations[0]??0);setDownload("");if(url.current){URL.revokeObjectURL(url.current);url.current="";}},[id]);
 const canQuote=Boolean(viewer.current&&model&&(model.modality==="transcription"?audio:model.modality==="batch"?lines(prompt).length>0&&lines(prompt).length<=8:
   model.modality==="decisions"?prompt.trim()&&documents.trim():model.modality==="rerank"?prompt.trim()&&lines(documents).length>0&&lines(documents).length<=40:prompt.trim()));
 return <section className="studio-ia">
  <StoreAppHeader title="Estudio IA" subtitle="Tu idea, en imagen, voz o vídeo." onBack={onBack}/>
  <p className="studio-ia-guide">Elige qué crear, describe tu idea y revisa el precio.</p>
  {models.length ? <div className="studio-ia-formats" aria-label="Formatos creativos">{([['image','Imagen',Image],['speech','Voz',Mic],['video','Vídeo',Video]] as const).map(([kind,label,Icon])=>{const available=models.find(item=>item.modality===kind);return available ? <Button key={kind} variant="secondary" aria-pressed={model?.modality===kind} disabled={busy||Boolean(pending)} onClick={()=>{setId(available.id);setResult(undefined);}}><Icon size={18}/>{label}</Button>:null;})}</div>:null}
  {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  {catalogIssue?<div className="studio-ia-unavailable" role="status">
    <h2>{catalogIssue==="disabled"?"Estudio IA aún no está activado":catalogIssue==="connection"?"Conecta tu cuenta de Mycellios":"No podemos cargar los modelos ahora"}</h2>
    <p>{catalogIssue==="disabled"?"La generación de imágenes, voz y vídeo no está habilitada en este entorno.":catalogIssue==="connection"?"Revisa tu conexión de Mycellios en Conexiones y vuelve a intentarlo.":"El servicio no está disponible temporalmente. Puedes volver a intentarlo sin enviar ningún trabajo."} No se ha gastado ningún crédito.</p>
    <Button variant="secondary" disabled={busy||Boolean(pending)} onClick={()=>void loadCatalog()}>{busy?"Comprobando…":catalogIssue==="disabled"?"Comprobar disponibilidad":"Reintentar"}</Button>
  </div>:null}
  {busy&&!models.length&&!catalogIssue?<p role="status" className="text-sm text-muted-foreground">Cargando modelos…</p>:null}
  {!models.length&&!busy&&!error&&!catalogIssue?<p className="text-sm text-muted-foreground">No hay modelos disponibles todavía. No se ha gastado ningún crédito.</p>:null}
  {models.length?<>
   <label className="block text-sm">Qué quieres crear<NativeSelect className="mt-2 w-full" disabled={busy||Boolean(pending)} value={id} onChange={e=>{setId(e.target.value);setResult(undefined);}}>{models.map(m=><option key={m.id} value={m.id}>{names[m.modality]} · {m.name}</option>)}</NativeSelect></label>
   {model?.modality==="transcription"?<label className="block text-sm">Tu audio (WAV o MP3, hasta 30 segundos)<input className="mt-2 block" type="file" accept=".wav,.mp3" disabled={busy||Boolean(pending)} onChange={e=>void act(async()=>{const file=e.target.files?.[0];if(!file)return;if(file.size>2*1024*1024)throw new Error("Elige un audio de hasta 2 MB y 30 segundos.");const prepared=await prepareNetworkTranscriptionAudio(file);const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]??"");reader.onerror=reject;reader.readAsDataURL(prepared);});if(alive.current)setAudio({data,format:"wav"});})}/></label>:
    <label className="block text-sm">{model?.modality==="speech"?"Qué quieres que diga":model?.modality==="batch"?"Textos del lote (uno por línea, hasta 8)":model?.modality==="rerank"?"Qué quieres encontrar":model?.modality==="decisions"?"Qué quieres comprobar (sí o no)":model?.modality==="embeddings"?"Texto para convertir en un vector":"Qué te gustaría crear"}<Textarea className="mt-2" value={prompt} maxLength={model?.modality==="batch"?32000:4000} disabled={busy||Boolean(pending)} onChange={e=>setPrompt(e.target.value)} placeholder={model?.modality==="batch"?"Resume este texto…\nTraduce esta frase…":"Describe tu idea…"}/></label>}
   {model?.modality==="speech"?<label className="block text-sm">Voz<NativeSelect className="mt-2 w-full" value={voice} disabled={busy||Boolean(pending)} onChange={e=>setVoice(e.target.value)}>{model.voices.map(v=><option key={v} value={v}>{v}</option>)}</NativeSelect></label>:null}
   {model?.modality==="video"?<label className="block text-sm">Duración<NativeSelect className="mt-2 w-full" value={duration} disabled={busy||Boolean(pending)} onChange={e=>setDuration(Number(e.target.value))}>{model.durations.map(v=><option key={v} value={v}>{v} segundos</option>)}</NativeSelect></label>:null}
   {model?.modality==="rerank"?<label className="block text-sm">Textos para ordenar (uno por línea, hasta 40)<Textarea className="mt-2" value={documents} maxLength={160000} disabled={busy||Boolean(pending)} onChange={e=>setDocuments(e.target.value)} placeholder="Primer texto…\nSegundo texto…"/></label>:null}
   {model?.modality==="decisions"?<label className="block text-sm">Texto para evaluar<Textarea className="mt-2" value={documents} maxLength={4000} disabled={busy||Boolean(pending)} onChange={e=>setDocuments(e.target.value)} placeholder="Pega el texto que quieres comprobar…"/></label>:null}
   {!pending?<Button disabled={busy||!canQuote} onClick={()=>void act(async()=>{const value=await call("quote",input());if(alive.current)setQuote(value);})}>Ver precio</Button>:<div className="space-y-2"><p role="status" className="text-sm">{pending==="running"?"Tu trabajo se está preparando…":"Estamos comprobando el resultado y su coste. No hace falta volver a enviarlo."}</p><Button variant="ghost" disabled={busy} onClick={()=>void act(async()=>{const reply=await call("status",{idempotencyKey:key.current});if(alive.current)accept(reply);})}>Comprobar estado</Button></div>}
   {quote&&!pending?<div className="space-y-3 rounded-xl bg-muted p-4"><p>{quote.maximumMicrounits===0?"Gratis":<>Hasta <strong>{credits(quote.maximumMicrounits??0)} créditos</strong></>}</p><p className="text-xs text-muted-foreground">{quote.maximumMicrounits===0?"No se descontarán créditos. Procesamiento externo.":"Incluye el 4 % de servicio Mycellios. Procesamiento externo. Se cobra el consumo real."}</p><Button disabled={busy} onClick={()=>void act(async()=>{key.current ||=crypto.randomUUID();if(recoveryKey.current)sessionStorage.setItem(recoveryKey.current,key.current);setPending("submitting");setResult(undefined);setDownload("");if(url.current){URL.revokeObjectURL(url.current);url.current="";}const reply=await call("execute",{request:input(),quoteToken:quote.token});if(alive.current){accept(reply);setQuote(undefined);}})}>{quote.maximumMicrounits===0?"Crear gratis":"Crear y usar créditos"}</Button></div>:null}
  </>:null}
  {result?<div className="space-y-3 rounded-xl border border-border p-4"><h2>{result.error?"No se pudo completar el trabajo":"Tu resultado"}</h2>{result.error?<p role="alert" className="text-sm">El proveedor ha comunicado un fallo. El importe de abajo corresponde al consumo confirmado; no se ha vuelto a enviar el trabajo.</p>:null}{result.text?<p className="whitespace-pre-wrap">{result.text}</p>:null}{result.images?.map((image:any,i:number)=>["image/png","image/jpeg","image/webp"].includes(image.media_type)?<img key={i} src={`data:${image.media_type};base64,${image.b64_json}`} alt="Imagen creada" className="w-full rounded-lg"/>:null)}{result.audio?<audio controls src={`data:audio/mpeg;base64,${result.audio.data}`}/>:null}{result.video?<Button disabled={busy} onClick={()=>void act(async()=>{const value=await call("content",{idempotencyKey:completedKey.current}) as any;const bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(new Blob([bytes],{type:"video/mp4"}));setDownload(url.current);})}>Abrir vídeo</Button>:null}{download?<><video controls src={download} className="w-full rounded-lg"/><a href={download} download="mycellios.mp4">Descargar vídeo</a></>:null}{result.decision?<p className="text-sm">{result.decision.type==="refusal"?"El modelo no ha podido evaluar este texto.":`Probabilidad de sí: ${new Intl.NumberFormat("es",{style:"percent",maximumFractionDigits:1}).format(result.decision.probability)}. Es una estimación del modelo.`}</p>:null}{result.embeddings?<p className="text-sm">Vector de {result.embeddings[0]?.embedding?.length??0} dimensiones listo.</p>:null}{result.results?<div className="space-y-2">{result.results.map((item:any,i:number)=><div key={item.id??item.index??i} className="text-sm"><span className="text-muted-foreground">{item.id?`Texto ${Number(item.id.split("-")[1])+1}`:`Resultado ${Number(item.index)+1}`} · </span>{item.error?"No se pudo completar este texto.":item.text??item.relevance_score}</div>)}</div>:null}{result.embeddings||result.results?<a className="inline-block text-sm underline" download="mycellios-result.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.embeddings??result.results))}`}>Descargar datos</a>:null}<p className="text-xs text-muted-foreground">{credits(result.mycellios?.creditsMicrounits??0)} créditos utilizados</p></div>:null}
  {models.length ? (<div className="border-t border-border pt-4"><p className="text-sm">¿Necesitas más créditos?</p><Button variant="secondary" disabled={busy||Boolean(pending)||!models.length} onClick={()=>void act(async()=>{checkoutKey.current ||= crypto.randomUUID();const reply=await call("checkout",{dollars:5});if(reply.url?.startsWith("https://checkout.stripe.com/"))setPayment(reply.url);})}>Recargar 5 créditos · 5 USD</Button>{payment?<a className="ml-3 text-sm underline" href={payment} target="_blank" rel="noopener noreferrer">Continuar al pago</a>:null}</div>) : null}
 </section>;
}
