import type { Artifact, ArtifactWithContent, Bot, AppCoverWrite } from "@rakazo/contracts";
import { APP_COVER_MAX_BYTES } from "@rakazo/contracts";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, NativeSelect,
  NativeSelectOption, Textarea, Tabs, TabsList, TabsTrigger, TabsContent } from "@rakazo/ui-web";
import { Sparkles, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { VideoStudioSample } from "../../components/VideoStudioSample";
import { useSpaceRpc } from "../../lib/space-rpc";
import { coverPrompt, readCoverGeneration, submitCoverGeneration } from "../../lib/app-cover-generation";
import type { CoverAppInfo, CoverGeneration } from "../../lib/app-cover-generation";

type Cover = { revision: string | null; image: Pick<ArtifactWithContent,"mimeType"|"contentBase64"> | null };
export type CoverImage = {mimeType:"image/png"|"image/jpeg"|"image/webp";contentBase64:string};
type Candidate = { src: string; source: AppCoverWrite["source"]; botId: string };
const raster = (type: string) => ["image/png", "image/jpeg", "image/webp"].includes(type);
const imageSource = (image: Pick<ArtifactWithContent,"mimeType"|"contentBase64">) => raster(image.mimeType)
  ? `data:${image.mimeType};base64,${image.contentBase64}` : "";

export function AppCover({ app, scope, fallback }: {
  app: CoverAppInfo; bots: Bot[]; scope: string; activeBotId?: string; fallback?: ReactNode;
}) {
  const rpc = useSpaceRpc();
  const [cover, setCover] = useState<Cover>({ revision: null, image: null });

  useEffect(() => {
    let current = true;
    void rpc.appCovers.get({ appId: app.id }).then(value => {
      if (current) { setCover(value); }
    }).catch(() => { /* Keep the bundled original when a legacy private cover is unavailable. */ });
    return () => { current = false; };
  }, [rpc, app.id, scope]);
  return <>
    {cover.image ? <div className="mycellios-app-preview"><img className="mycellios-app-cover-image"
      src={imageSource(cover.image)} alt={`Carátula de ${app.title}`} /></div> : fallback ?? <VideoStudioSample catalog />}
  </>;
}

export function AppCoverEditor({ app, bots, activeBotId, scope, cover, initialError, onClose, onSaved, onApply }: {
  app: CoverAppInfo; bots: Bot[]; activeBotId?: string; scope: string; cover: Cover;
  initialError: string; onClose: () => void; onSaved: (cover: Cover) => void; onApply?: (image:CoverImage|null)=>void|Promise<void>;
}) {
  const rpc = useSpaceRpc();
  const navigate = useNavigate();
  const key = `mycellios:app-cover-generation:${scope}:${app.id}`;
  const [generation, setGeneration] = useState(() => readCoverGeneration(key));
  const [botId, setBotId] = useState(generation?.botId ?? activeBotId ?? bots[0]?.id ?? "");
  const [style, setStyle] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [images, setImages] = useState<Artifact[]>([]);
  const [error, setError] = useState(initialError);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [generationDone, setGenerationDone] = useState(false);
  const [tab, setTab] = useState(generation ? "generate" : "upload");
  const alive = useRef(true);
  const submission = useRef(false);
  const imageRequest = useRef(0);
  const file = useRef<HTMLInputElement>(null);
  const selectedBot = bots.find(bot => bot.id === botId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function persist(value: CoverGeneration) {
    localStorage.setItem(key, JSON.stringify(value));
    if (alive.current) setGeneration(value);
  }
  function forgetGeneration() {
    localStorage.removeItem(key); setGeneration(null); setGenerationDone(false); setImages([]); setStatus(""); setError("");
  }
  async function chooseImage(artifact: Artifact) {
    const image = await rpc.artifacts.getById({ artifactId: artifact.id });
    if (!raster(image.mimeType) || !image.botId || image.groupId) throw new Error("Imagen no disponible.");
    if (alive.current) setCandidate({ src: imageSource(image), botId: image.botId,
      source: { kind: "artifact", artifactId: image.id } });
  }
  useEffect(() => {
    if (!generation?.runId || !generation.taskThreadId) return;
    let current = true, pending = false, finished = false;
    const request = generation;
    const check = async () => {
      if (pending || finished || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const [run, artifacts] = await Promise.all([
          rpc.development.status({ botId: request.botId, taskThreadId: request.taskThreadId!, runId: request.runId! }),
          rpc.artifacts.list({ botId: request.botId }),
        ]);
        if (!current) return;
        const results = artifacts.filter(a => a.runId === request.runId && raster(a.mimeType) && !a.groupId);
        if (results.length) {
          finished = true;
          setGenerationDone(true);
          setImages(results); setStatus("Imagen lista. Revísala y aplica la que prefieras.");
          // Load the candidate only; applying always requires the explicit save button.
          const image = await rpc.artifacts.getById({ artifactId: results[0]!.id });
          if (current && raster(image.mimeType)) setCandidate({ src: imageSource(image), botId: request.botId,
            source: { kind: "artifact", artifactId: image.id } });
          return;
        }
        if (["completed", "failed", "canceled", "cancelled"].includes(run.status)) {
          finished = true;
          setGenerationDone(true);
          setStatus(""); setError("El Mico no ha devuelto una imagen. Abre la conversación para ver su respuesta o sus límites de generación.");
        } else if (["waiting_input", "waiting_approval", "waiting_takeover"].includes(run.status)) {
          setStatus("Tu Mico necesita tu intervención. Abre su conversación para continuar.");
        } else setStatus("Tu Mico está preparando la carátula. Puedes cerrar esta ventana y volver después.");
      } catch { if (current) setError("No se pudo consultar la generación. No se ha enviado otra solicitud."); }
      finally { pending = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    const visible = () => void check();
    document.addEventListener("visibilitychange", visible);
    return () => { current = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [rpc, generation?.runId, generation?.taskThreadId, generation?.botId]);
  async function generate() {
    if (!selectedBot || submission.current) return;
    submission.current = true; setBusy(true); setError("");
    try {
      const request = generation ?? { nonce: crypto.randomUUID(), botId, prompt: coverPrompt(app, style) };
      await submitCoverGeneration(rpc, app.id, request, persist);
    } catch { if (alive.current) setError("No se pudo confirmar el envío. Recupera la misma solicitud para evitar generar dos veces."); }
    finally { submission.current = false; if (alive.current) setBusy(false); }
  }
  async function upload(selected: File) {
    setError("");
    if (!raster(selected.type) || selected.size > APP_COVER_MAX_BYTES) {
      setError("Elige una imagen PNG, JPG o WebP de hasta 8 MB."); return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(selected);
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error();
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const src = canvas.toDataURL("image/webp", 0.9);
        const match = /^data:(image\/(?:webp|png));base64,(.+)$/.exec(src);
        if (!match || match[2]!.length > APP_COVER_MAX_BYTES * 4 / 3) throw new Error();
        if (alive.current) setCandidate({ src, botId, source: { kind: "upload",
          mimeType: match[1] as "image/webp" | "image/png", contentBase64: match[2]! } });
      } finally { bitmap.close(); }
    } catch { if (alive.current) setError("No se pudo leer esa imagen. Prueba con otra."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save(reset = false) {
    if ((!selectedBot && !onApply) || submission.current || (!reset && !candidate) || initialError) return;
    submission.current = true; setBusy(true); setError("");
    try {
      if(onApply) {
        const match=reset?null:/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(candidate!.src);
        if(!reset&&!match)throw new Error("La imagen no es compatible.");
        await onApply(match?{mimeType:match[1] as CoverImage["mimeType"],contentBase64:match[2]!}:null);
        if(alive.current){localStorage.removeItem(key);onClose();}return;
      }
      const next = await rpc.appCovers.set({ appId: app.id,
        botId: reset ? botId : candidate!.source.kind === "artifact" ? candidate!.botId : botId,
        expectedRevision: cover.revision, clientNonce: crypto.randomUUID(),
        source: reset ? { kind: "default" } : candidate!.source });
      if (alive.current) { localStorage.removeItem(key); onSaved(next); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "No se pudo guardar la carátula."); }
    finally { submission.current = false; if (alive.current) setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Carátula de {app.title}</DialogTitle>
        <DialogDescription>{onApply?"Solo el creador puede cambiarla. Se actualizará para todos al publicar la app.":"Carátula de tu app. Solo su creador puede modificarla."}</DialogDescription></DialogHeader>
      <div className="app-cover-editor-preview">
        {candidate || cover.image ? <img src={candidate?.src ?? imageSource(cover.image!)} alt="Vista previa de la carátula" /> : <VideoStudioSample catalog />}
      </div>
      {(!onApply||tab==="generate")&&<label className="grid gap-1.5 text-sm">Mico
        <NativeSelect className="w-full" aria-label="Mico para la carátula" value={botId} disabled={busy || Boolean(generation)}
          onChange={event => { imageRequest.current++; setBotId(event.target.value); setImages([]); }}>
          {bots.map(bot => <NativeSelectOption key={bot.id} value={bot.id}>{bot.name}</NativeSelectOption>)}
        </NativeSelect>
      </label>}
      {!bots.length && !onApply && <p role="status" className="text-sm text-muted-foreground">Crea un Mico para guardar o generar tu carátula.</p>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="upload">Subir imagen</TabsTrigger><TabsTrigger value="generate" disabled={!bots.length}>Generar con un Mico</TabsTrigger></TabsList>
        <TabsContent value="upload" className="space-y-2 pt-2">
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
            aria-label="Archivo de carátula" onChange={event => { const image = event.target.files?.[0]; event.target.value = ""; if (image) void upload(image); }} />
          <Button variant="outline" disabled={busy || (!selectedBot&&!onApply)} onClick={() => file.current?.click()}><Upload size={16} aria-hidden />Elegir imagen</Button>
          <p className="text-xs text-muted-foreground">PNG, JPG o WebP · Hasta 8 MB. La carátula se recorta para llenar la tarjeta.</p>
        </TabsContent>
        <TabsContent value="generate" className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">Usa el modelo y las herramientas de imagen autorizadas de {selectedBot?.name ?? "tu Mico"}. El pedido incluirá el nombre y la descripción de esta app.</p>
          <Textarea aria-label="Estilo de la carátula" placeholder="¿Cómo la quieres? Por ejemplo: un estudio de cine abstracto, con verde y tonos cálidos." value={style} maxLength={3000}
            disabled={busy || Boolean(generation)} onChange={event => setStyle(event.target.value)} />
          {!generation?.runId && <Button variant="outline" disabled={busy || !selectedBot} onClick={() => void generate()}><Sparkles size={16} aria-hidden />{generation ? "Recuperar solicitud" : "Generar carátula"}</Button>}
          {generation?.taskThreadId && <Button variant="link" onClick={() => navigate(`/app/${encodeURIComponent(generation.botId)}?task=${encodeURIComponent(generation.taskThreadId!)}`)}>Ver conversación del Mico</Button>}
          {generationDone && <Button variant="ghost" disabled={busy} onClick={forgetGeneration}>Preparar otra carátula</Button>}
          <Button variant="ghost" disabled={busy || !selectedBot} onClick={() => {
            setError(""); const request = ++imageRequest.current; void rpc.artifacts.list({ botId }).then(list => {
              if (alive.current && imageRequest.current === request) { const found = list.filter(a => raster(a.mimeType) && !a.groupId && !a.name.startsWith("mycellios-app-cover-")).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,12); setImages(found); if (!found.length) setStatus("Este Mico todavía no tiene imágenes."); }
            }).catch(() => { if (alive.current && imageRequest.current === request) setError("No se pudieron cargar las imágenes del Mico."); });
          }}>Elegir una imagen de este Mico</Button>
        </TabsContent>
      </Tabs>
      {images.length > 0 && <div className="app-cover-candidates" aria-label="Imágenes del Mico">
        {images.map(image => <Button key={image.id} variant="outline" disabled={busy} onClick={() => void chooseImage(image).catch(() => setError("No se pudo cargar esa imagen."))}>{image.name}</Button>)}
      </div>}
      {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {cover.image && <Button variant="ghost" disabled={busy || (!selectedBot&&!onApply) || Boolean(initialError)} onClick={() => void save(true)}>Restaurar original</Button>}
        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        <Button disabled={busy || !candidate || (!selectedBot&&!onApply) || Boolean(initialError)} onClick={() => void save()}>{busy ? "Preparando…" : "Aplicar carátula"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
