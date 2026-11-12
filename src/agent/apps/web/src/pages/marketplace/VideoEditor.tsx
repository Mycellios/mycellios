import { StoreAppHeader } from "./StoreAppHeader";
import { useEffect, useRef, useState } from "react";
import {  Film, Upload, Download, RefreshCw } from "lucide-react";
import { Button, Textarea } from "@rakazo/ui-web";
import type { VideoEditBridge, VideoEditProject } from "@rakazo/contracts";
import { VIDEO_EDIT_MAX_BYTES } from "@rakazo/contracts";
import { desktopBridge } from "../../lib/desktop";

const price = (micros: number) => new Intl.NumberFormat("es", { maximumFractionDigits: 6 }).format(micros / 1_000_000);
const labels = { draft:"Preparado", quoted:"Presupuesto listo", submitting:"Enviando una vez…", running:"Editando tu vídeo…", ready:"Tu vídeo está listo", failed:"No se pudo completar", uncertain:"Hay que comprobar el envío" };
export function VideoEditor({ onBack, bridge = desktopBridge()?.videoEdit }: { onBack: () => void; bridge?: VideoEditBridge }) {
  const [projects,setProjects] = useState<VideoEditProject[]>([]);
  const [project,setProject] = useState<VideoEditProject>();
  const [prompt,setPrompt] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [providerReady,setProviderReady] = useState(false), [creditsReady,setCreditsReady] = useState(false);
  const [connectionFailed,setConnectionFailed] = useState(false);
  const [source,setSource] = useState(""), [result,setResult] = useState("");
  const alive = useRef(true), pending = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current=true; return () => {alive.current=false;}; },[]);
  const keep = (value: VideoEditProject) => {
    setProject(value); setProjects(old => [value,...old.filter(p=>p.id!==value.id)]);
  };
  async function action(work: () => Promise<void>) {
    if(pending.current) return;
    pending.current=true; setBusy(true); setError("");
    try { await work(); } catch(e) { if(alive.current) setError(e instanceof Error ? e.message : "No se pudo completar la operación."); }
    finally { pending.current=false; if(alive.current) setBusy(false); }
  }
  useEffect(() => {
    if(!bridge) return;
    let live=true;
    void bridge.request({action:"list"}).then(value=>{if(live && "projects" in value){setProjects(value.projects);setProviderReady(value.providerReady);setCreditsReady(value.creditsReady);}}).catch(()=>{if(live){setConnectionFailed(true);setError("Reconecta este PC para abrir tus proyectos locales.");}});
    return ()=>{live=false;};
  },[bridge]);
  useEffect(() => {
    setSource("");setResult("");
    if(!bridge || !project) return;
    let live=true;
    for(const kind of project.status==="ready" ? ["source","result"] as const : ["source"] as const)
      void bridge.request({action:"artifact",id:project.id,kind}).then(v=>{if(live && "data" in v){const url=`data:video/mp4;base64,${v.data}`;if(kind==="source")setSource(url);else setResult(url);}}).catch(()=>{if(live)setError("No se pudo leer el vídeo guardado.");});
    return ()=>{live=false;};
  },[bridge,project?.id,project?.status]);
  useEffect(() => {
    if(!bridge || !project || !["running","submitting","uncertain"].includes(project.status))return;
    let live=true, polling=false;
    const timer=setInterval(()=>{
      if(document.hidden || polling || pending.current)return;
      polling=true;
      void bridge.request({action:"get",id:project.id}).then(v=>{if(live && "status" in v)keep(v);}).catch(()=>{if(live)setError("No se pudo actualizar el estado. El trabajo guardado no se reenviará.");}).finally(()=>{polling=false;});
    },5000);
    return ()=>{live=false;clearInterval(timer);};
  },[bridge,project?.id,project?.status]);
  async function upload(selected: File) {
    if(!bridge)return;
    if(selected.size>VIDEO_EDIT_MAX_BYTES || !selected.name.toLowerCase().endsWith(".mp4"))throw new Error("Selecciona un MP4 de hasta 24 MB.");
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]??"");reader.onerror=()=>reject(new Error("No se pudo leer el vídeo."));reader.readAsDataURL(selected);});
    const value=await bridge.request({action:"import",name:selected.name,data});
    if(alive.current && "status" in value){keep(value);setPrompt("");}
  }
  const locked=Boolean(project && !["draft","quoted"].includes(project.status));
  const quote=project?.quote;
  const canSubmit=Boolean(quote && project?.status==="quoted" && prompt.trim()===project.prompt && Date.parse(quote.expiresAt)>Date.now() && creditsReady);
  return <section className="mx-auto w-full max-w-4xl space-y-6 pb-8" data-testid="video-editor">
    <StoreAppHeader title="Editar vídeo" onBack={onBack}/><p className="text-sm text-muted-foreground">Sube un clip, pide un cambio y revisa el precio antes de editar.</p>
    {!bridge ? <p role="status" className="rounded-xl bg-muted p-4 text-sm">Abre esta app en Mycellios Desktop con el acceso a este PC conectado. Tus vídeos se guardan localmente.</p> : null}
    <input ref={file} type="file" accept="video/mp4,.mp4" className="sr-only" aria-label="Seleccionar vídeo MP4" onChange={e=>{const selected=e.target.files?.[0];e.target.value="";if(selected)void action(()=>upload(selected));}}/>
    {!project ? <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const selected=e.dataTransfer.files[0];if(selected && bridge)void action(()=>upload(selected));}}>
      <Film size={36} strokeWidth={1.3} className="mx-auto mb-4 text-muted-foreground"/><h2 className="text-base font-medium">¿Qué vídeo quieres transformar?</h2><p className="my-3 text-sm text-muted-foreground">Arrastra un MP4 H.264 de 1–30 segundos, hasta 24 MB.</p><Button disabled={!bridge || busy} onClick={()=>file.current?.click()}><Upload size={16}/>Subir vídeo</Button>
    </div> : <>
      <div className={`grid gap-4 ${result?"md:grid-cols-2":""}`}>
        <div><h2 className="mb-2 text-sm">Original · {project.name}</h2>{source?<video controls preload="metadata" src={source} className="max-h-80 w-full rounded-xl bg-muted"/>:<div className="h-48 rounded-xl bg-muted"/>}<p className="mt-2 text-xs text-muted-foreground">{project.width} × {project.height} · {project.duration.toFixed(1)} s</p></div>
        {result?<div><h2 className="mb-2 text-sm">Resultado</h2><video controls preload="metadata" src={result} className="max-h-80 w-full rounded-xl bg-muted"/><a href={result} download={`editado-${project.name}`} className="mt-3 inline-flex items-center gap-2 underline underline-offset-4"><Download size={15}/>Descargar vídeo</a></div>:null}
      </div>
      <div className="space-y-3"><label htmlFor="video-edit-prompt" className="text-sm font-medium">¿Qué quieres cambiar?</label><Textarea id="video-edit-prompt" value={prompt} maxLength={2000} disabled={busy||locked} onChange={e=>setPrompt(e.target.value)} placeholder="Haz que llueva y conserva a la persona y el movimiento de la cámara."/>
        {!locked?<div className="flex flex-wrap gap-2">{["Haz que llueva", "Dale un estilo cinematográfico", "Cambia el fondo a un bosque"].map(text=><Button key={text} size="sm" variant="secondary" disabled={busy} onClick={()=>setPrompt(text)}>{text}</Button>)}</div>:null}
      </div>
      {quote && project.status==="quoted" && prompt.trim()===project.prompt?<div className="rounded-xl bg-muted p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-medium">{price(quote.creditsMicros)} créditos</h2><p className="mt-1 text-xs text-muted-foreground">{quote.model} · {quote.resolution} · {Math.floor(project.duration)} s</p><p className="mt-1 text-xs text-muted-foreground">Incluye el 4 % de servicio Mycellios. Se reserva al confirmar y se cobra tras verificar el resultado y su recibo.</p></div><Button disabled={busy||!canSubmit} onClick={()=>void action(async()=>{if(!bridge)return;const v=await bridge.request({action:"submit",id:project.id,quoteId:quote.id});if(alive.current&&"status"in v)keep(v);})}>Editar por {price(quote.creditsMicros)} créditos</Button></div></div>:null}
      {!locked?<Button disabled={busy||!bridge||prompt.trim().length<3} onClick={()=>void action(async()=>{if(!bridge)return;const v=await bridge.request({action:"quote",id:project.id,prompt:prompt.trim()});if(alive.current&&"status"in v)keep(v);})}>{busy?"Comprobando…":"Ver precio"}</Button>:<p role="status" className="text-sm">{labels[project.status]}</p>}
      {project.status==="ready"&&project.chargedCreditsMicros!==undefined?<p className="text-sm text-muted-foreground">{price(project.chargedCreditsMicros)} créditos utilizados · servicio Mycellios incluido</p>:null}
      {project.error?<p role="alert" className="text-sm text-destructive">{project.error}</p>:null}
      <Button variant="ghost" disabled={busy} onClick={()=>{setProject(undefined);setPrompt("");}}>Editar otro vídeo</Button>
    </>}
    {bridge && !providerReady?<p className="text-sm text-muted-foreground">La edición con Mycellios no está disponible todavía. Puedes guardar tu clip localmente; no se envía ni se cobra nada.</p>:null}
    {bridge && !creditsReady?<p className="text-sm text-muted-foreground">El monedero de este entorno está desactivado. Las ediciones de pago permanecen bloqueadas.</p>:null}
    {connectionFailed?<Button variant="secondary" disabled={busy} onClick={()=>void action(async()=>{
      const computer=desktopBridge()?.computer;
      if(!computer || !(await computer.requestAccess()))throw new Error("No se ha autorizado el acceso a este PC.");
      const value=await bridge!.request({action:"list"});
      if(alive.current && "projects"in value){setProjects(value.projects);setProviderReady(value.providerReady);setCreditsReady(value.creditsReady);setConnectionFailed(false);}
    })}>Conectar este PC</Button>:null}
    {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
    {projects.length?<section className="border-t border-border pt-4"><h2 className="mb-3 text-sm font-medium">Tus ediciones en este PC</h2><div className="space-y-1">{projects.map(p=><Button key={p.id} variant="ghost" className="flex h-auto w-full justify-between py-3 text-start" disabled={busy} onClick={()=>void action(async()=>{if(!bridge)return;const v=await bridge.request({action:"get",id:p.id});if(alive.current&&"status"in v){keep(v);setPrompt(v.prompt);}})}><span className="truncate">{p.name}</span><span className="ms-3 text-xs text-muted-foreground">{labels[p.status]}</span><RefreshCw size={13}/></Button>)}</div></section>:null}
  </section>;
}
