import manifest from "../assets/apps/video-edit/app.json" with { type: "json" };
import { canonicalAppJson } from "../../../packages/contracts/src/app-manifest.js";
import { validateAppManifest } from "../../../packages/contracts/src/app-validation.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { VideoEditRequestSchema, VIDEO_EDIT_MAX_BYTES, type VideoEditProject, type VideoEditRequest, type VideoEditResponse } from "../../../packages/contracts/src/video-edit.js";
import { studioCommand, studioScopeKey, type StudioScope } from "./apps-studio-runtime.js";
import type { EditSource, VideoEditProvider } from "./video-edit-provider.js";
import {EditNotSubmittedError,type ManagedVideoEditService} from "./video-edit-wallet.js";

/** Implemented by the authoritative Credits service, never by a renderer balance. */
export interface VideoEditCredits {
  reserve(scope: StudioScope, key: string, micros: number): Promise<void>;
  settle(scope: StudioScope, key: string, micros: number, artifactHash: string): Promise<void>;
  release(scope: StudioScope, key: string): Promise<void>;
}
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export class VideoEditRuntime {
  private locks = new Map<string, Promise<unknown>>();
  constructor(private root: string, private provider: VideoEditProvider, private credits?: VideoEditCredits,
    private command = studioCommand, private clock = () => Date.now()) { if (!validateAppManifest(manifest).ok) throw new Error("La definición del editor no es válida."); }
  async request(scope: StudioScope, raw: VideoEditRequest, authorized: () => Promise<boolean>,managed?:ManagedVideoEditService): Promise<VideoEditResponse> {
    const input = VideoEditRequestSchema.parse(raw);
    const base = path.join(this.root, studioScopeKey(scope));
    if (!(await authorized())) throw new Error("La sesión o el espacio han cambiado.");
    await mkdir(base, { recursive: true, mode: 0o700 });
    const key = base + ("id" in input ? input.id : ":import");
    if (!this.locks.has(key) && this.locks.size >= 4) throw new Error("Espera a que terminen las operaciones locales en curso.");
    const prior = this.locks.get(key) ?? Promise.resolve();
    const work = prior.catch(() => {}).then(() => this.execute(base, scope, input, authorized,managed));
    this.locks.set(key, work);
    try { return await work; } finally { if (this.locks.get(key) === work) this.locks.delete(key); }
  }
  private async save(dir: string, project: VideoEditProject) {
    project.updatedAt = new Date(this.clock()).toISOString();
    const temp = path.join(dir, `${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(project), { mode: 0o600 });
    await rename(temp, path.join(dir, "project.json"));
  }
  private async probe(file: string): Promise<EditSource> {
    const text = await this.command(process.env.MYCELLIOS_FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", file], path.dirname(file), AbortSignal.timeout(20_000));
    const result = JSON.parse(text);
    const video = result.streams?.find((s: any) => s.codec_type === "video");
    const duration = Number(result.format?.duration);
    if (!video || video.codec_name !== "h264" || !Number.isFinite(duration) || duration < 1 || duration > 30 ||
      !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 128 || video.height < 128 || video.width > 3840 || video.height > 3840)
      throw new Error("Usa un MP4 H.264 de 1–30 segundos, con dimensiones entre 128 y 3840 píxeles.");
    return { duration, width: video.width, height: video.height };
  }
  private async execute(base: string, scope: StudioScope, input: VideoEditRequest, authorized: () => Promise<boolean>,managed?:ManagedVideoEditService): Promise<VideoEditResponse> {
    if (!(await authorized())) throw new Error("La sesión o el espacio han cambiado.");
    if (input.action === "list") {
      const projects: VideoEditProject[] = [];
      for (const entry of await readdir(base, { withFileTypes: true })) if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
        try { projects.push(JSON.parse(await readFile(path.join(base, entry.name, "project.json"), "utf8"))); } catch { /* incomplete import */ }
      }
      let providerReady = false;
      try { if(managed)providerReady=await managed.info();else {await this.provider.offers({ duration: 5, width: 1280, height: 720 });providerReady=true;} } catch { /* no provider; files stay local */ }
      return { projects: projects.sort((a,b) => b.createdAt.localeCompare(a.createdAt)), providerReady, creditsReady: managed?providerReady:Boolean(this.credits) };
    }
    if (input.action === "import") {
      if ((await readdir(base, {withFileTypes:true})).filter(entry=>entry.isDirectory()).length >= 20) throw new Error("Se alcanzó el límite de 20 proyectos locales.");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new Error("El vídeo no es válido.");
      const bytes = Buffer.from(input.data, "base64");
      if (!bytes.length || bytes.length > VIDEO_EDIT_MAX_BYTES || bytes.toString("base64") !== input.data || bytes.subarray(4,8).toString() !== "ftyp") throw new Error("Selecciona un vídeo MP4 de hasta 24 MB.");
      const id = randomUUID(), dir = path.join(base, id);
      await mkdir(dir, { mode: 0o700 });
      const file = path.join(dir, "source.mp4");
      await writeFile(file, bytes, { mode: 0o600 });
      const source = await this.probe(file);
      if (!(await authorized())) throw new Error("La sesión o el espacio han cambiado.");
      const project: VideoEditProject = { id, appId: manifest.id, appVersion: manifest.version, definitionHash: digest(canonicalAppJson(manifest)), name: input.name.replace(/[\x00-\x1f]/g, ""), sourceHash: digest(bytes), ...source,
        prompt: "", status: "draft", createdAt: new Date(this.clock()).toISOString(), updatedAt: new Date(this.clock()).toISOString() };
      await this.save(dir, project); return project;
    }
    const dir = path.join(base, input.id);
    const project: VideoEditProject = JSON.parse(await readFile(path.join(dir, "project.json"), "utf8"));
    if (project.id !== input.id) throw new Error("Proyecto no disponible.");
    if (input.action === "artifact") {
      if (input.kind === "result" && project.status !== "ready") throw new Error("El resultado aún no está disponible.");
      const bytes = await readFile(path.join(dir, input.kind === "source" ? "source.mp4" : "result.mp4"));
      if (!(await authorized())) throw new Error("La sesión o el espacio han cambiado.");
      return { data: bytes.toString("base64"), mimeType: "video/mp4" };
    }
    if (input.action === "quote") {
      if (!["draft", "quoted"].includes(project.status)) throw new Error("Este trabajo ya se envió. Consulta su resultado; no lo vuelvas a enviar.");
      if(managed){const quote=await managed.quote(project,input.prompt);if(!(await authorized()))throw new Error("La sesión o el espacio han cambiado.");project.prompt=input.prompt;project.quote=quote;project.status="quoted";await this.save(dir,project);return project;}
      const offers = await this.provider.offers(project);
      if (!offers.length) throw new Error("No hay modelos de edición compatibles con este clip y un precio verificable de hasta 1 crédito.");
      if (!(await authorized())) throw new Error("La sesión o el espacio han cambiado.");
      project.prompt = input.prompt;
      project.quote = { ...offers[0]!, id: randomUUID(), expiresAt: new Date(this.clock()+5*60_000).toISOString(), sourceHash: project.sourceHash, promptHash: digest(input.prompt) };
      project.status = "quoted"; await this.save(dir, project); return project;
    }
    if (input.action === "submit") {
      // A second click or an interrupted session must never create a second paid job.
      if (!["draft", "quoted"].includes(project.status)) return project;
      const quote = project.quote;
      if (!quote || quote.id !== input.quoteId || Date.parse(quote.expiresAt) <= this.clock() || quote.promptHash !== digest(project.prompt) || quote.sourceHash !== project.sourceHash)
        throw new Error("El presupuesto ha caducado o cambió el vídeo. Solicita uno nuevo.");
      if(quote.managed){
        if(!managed)throw new Error("Reconecta el monedero Mycellios antes de enviar.");
        const bytes=await readFile(path.join(dir,"source.mp4"));if(digest(bytes)!==project.sourceHash||!(await authorized()))throw new Error("La fuente o la sesión han cambiado.");
        project.status="submitting";await this.save(dir,project);
        try{if(!(await authorized()))throw new Error("session_changed");await managed.submit(project,bytes);project.status="running";}
        catch(error){if(error instanceof EditNotSubmittedError){project.status="draft";delete project.quote;project.error=error.message;}else{project.status="uncertain";project.error="No se pudo confirmar el envío. Consulta el estado; no se volverá a enviar ni a cobrar otra edición.";}}
        await this.save(dir,project);return project;
      }
      if (!this.credits) throw new Error("El cobro con créditos Mycellios todavía no está conectado. No se ha enviado ni cobrado nada.");
      const offers = await this.provider.offers(project);
      if (!offers.some(o => o.model === quote.model && o.seller === quote.seller && o.protocol === quote.protocol && o.resolution === quote.resolution && o.creditsMicros === quote.creditsMicros))
        throw new Error("El precio o el proveedor han cambiado. Solicita un presupuesto nuevo.");
      const bytes = await readFile(path.join(dir,"source.mp4"));
      if (digest(bytes) !== project.sourceHash || !(await authorized())) throw new Error("La fuente o la sesión han cambiado.");
      await this.credits.reserve(scope, project.id, quote.creditsMicros);
      project.status = "submitting"; await this.save(dir,project);
      try {
        if (!(await authorized())) { await this.credits.release(scope,project.id); project.status="failed"; project.error="La sesión cambió antes del envío."; }
        else { project.jobId = await this.provider.create(quote,project.prompt,bytes,project); project.status="running"; }
      } catch { project.status="uncertain"; project.error="No se pudo confirmar el envío. Conservamos la reserva y no repetiremos la edición. Revisa el trabajo antes de continuar."; }
      await this.save(dir,project); return project;
    }
    if(project.quote?.managed && ["running","submitting","uncertain"].includes(project.status)) {
      if(!managed)throw new Error("Reconecta Mycellios para comprobar este trabajo.");
      const result=await managed.get(project);
      if(result.ready){const temp=path.join(dir,"result.pending.mp4");await writeFile(temp,result.bytes,{mode:0o600});await this.probe(temp);
        if(!(await authorized()))throw new Error("La sesión o el espacio han cambiado.");
        await rename(temp,path.join(dir,"result.mp4"));project.resultHash=result.hash;project.chargedCreditsMicros=result.credits;project.status="ready";delete project.error;
      }else{project.status="running";delete project.error;}
      await this.save(dir,project);return project;
    }
    if (project.status === "submitting") { project.status="uncertain"; project.error="La sesión se interrumpió durante el envío. No se reenviará automáticamente."; await this.save(dir,project); }
    if (project.status === "running" && project.jobId && project.quote && this.credits) {
      const result = await this.provider.retrieve(project.quote, project.jobId);
      if (result.status === "failed") { await this.credits.release(scope,project.id); project.status="failed"; project.error="El proveedor no pudo editar el vídeo. No se reenviará automáticamente."; }
      if (result.status === "ready") {
        if (Buffer.from(result.bytes.subarray(4,8)).toString() !== "ftyp") throw new Error("El proveedor no entregó un MP4 válido.");
        const temp = path.join(dir,"result.pending.mp4"); await writeFile(temp,result.bytes,{mode:0o600}); await this.probe(temp);
        if (!(await authorized())) throw new Error("La sesión o el espacio han cambiado.");
        const hash = digest(result.bytes);
        await rename(temp,path.join(dir,"result.mp4"));
        await this.credits.settle(scope,project.id,project.quote.creditsMicros,hash);
        project.resultHash=hash; project.status="ready";
      }
      await this.save(dir,project);
    }
    return project;
  }
}
