import { StoreAppHeader } from "./marketplace/StoreAppHeader";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@rakazo/ui-web";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  StudioProject,
  StudioRequest,
  StudioResponse,
  VideoScene,
} from "../../../../packages/contracts/src/app-studio.js";
import { desktopBridge } from "../lib/desktop";
import { videoStudioFrames } from "../lib/video-studio-frames";
import { VideoStudioSample } from "../components/VideoStudioSample";
import { DesktopDownloadLink } from "../components/DesktopDownloadLink";

const steps = ["Idea", "Guion", "Voz y escenas", "Revisión", "MP4"];

function StudioSteps({ current, complete }: { current: number; complete: boolean }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-x-5 gap-y-3 border-b border-border pb-4" aria-label="Pasos del estudio">
      {steps.map((step, index) => {
        const done = index < current || complete;
        const active = index === current && !complete;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className={`flex items-center gap-2 text-xs ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}
          >
            <span className={`grid size-6 place-items-center rounded-full ${active ? "bg-foreground text-background" : done ? "bg-success/10 text-success" : "bg-muted"}`}>
              {done ? <Check size={14} aria-label="Completado" /> : index + 1}
            </span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}
const progress = (p: StudioProject) =>
  p.result
    ? 4
    : p.approvedRevision === p.revision
      ? 4
      : p.voiceRevision === p.revision && p.previewRevision === p.revision
        ? 3
        : p.scenes.length
          ? 2
          : 1;

function message(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
    : "No se pudo completar el paso.";
}

export function AppsOverlay({ onClose, scope }: { onClose(): void; scope: string }) {
  const bridge = desktopBridge()?.appsStudio;
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selected, setSelected] = useState<StudioProject | null>(null);
  const [topic, setTopic] = useState("");
  const [scenes, setScenes] = useState<VideoScene[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string[]>([]);
  const [audio, setAudio] = useState<string[]>([]);
  const [video, setVideo] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const blocked = Boolean(busy || selected?.activeStep);
  const alive = useRef(true);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const url of urls.current) URL.revokeObjectURL(url);
    };
  }, []);
  const request = async (input: StudioRequest) => {
    if (!bridge)
      throw new Error(
        "Abre esta app en Mycellios Desktop con acceso al PC. Cloud aún no está disponible.",
      );
    return bridge.request(input);
  };
  const load = async () => {
    const result = await request({ action: "list" });
    if (alive.current && "projects" in result) setProjects(result.projects);
  };
  useEffect(() => {
    if (!bridge) return;
    void load().catch((e) => {
      if (alive.current) setError(message(e));
    });
  }, [scope]);
  useEffect(() => {
    if (!selected?.activeStep || busy || dirty) return;
    const id = selected.id;
    const timer = window.setInterval(() => {
      void request({ action: "list" })
        .then((result) => {
          if (!alive.current || !("projects" in result)) return;
          setProjects(result.projects);
          const current = result.projects.find((p) => p.id === id);
          if (current) {
            setSelected(current);
            setScenes(current.scenes);
            if (current.lastError) setError(current.lastError);
          }
        })
        .catch((e) => setError(message(e)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selected?.activeStep, selected?.id, busy, dirty]);
  const select = (p: StudioProject) => {
    setSelected(p);
    setScenes(p.scenes);
    setDirty(false);
    setError(p.lastError ?? "");
    setAudio([]);
    setVideo("");
    setReviewed(false);
    setPreview(p.scenes.length ? videoStudioFrames(p.scenes) : []);
  };
  const artifactUrl = async (
    p: StudioProject,
    kind: "voice" | "video" | "image",
    index?: number,
  ) => {
    const result = await request({ action: "artifact", id: p.id, kind, index });
    if (!("data" in result)) throw new Error("El ejecutor no devolvió el archivo.");
    const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
    urls.current.push(url);
    return url;
  };
  const perform = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await work();
      if (alive.current) await load();
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const update = (result: StudioResponse) => {
    if (!("id" in result)) throw new Error("Respuesta de proyecto inesperada.");
    if (alive.current) {
      setSelected(result);
      setScenes(result.scenes);
      setDirty(false);
    }
    return result;
  };
  const close = () => {
    if (!blocked && !dirty) onClose();
    else
      setError(
        blocked
          ? "Espera al paso en curso o pulsa Cancelar antes de cerrar."
          : "Guarda el guion antes de cerrar para conservarlo.",
      );
  };
  const panel = selected ? progress(selected) : 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        data-apps-studio="true"
        showCloseButton={false}
        className={`flex max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-5xl ${selected ? "h-[min(860px,calc(100dvh-2rem))]" : ""}`}
      >
        <DialogHeader className="px-5 py-4">
          <DialogTitle className="sr-only">Estudio de vídeos</DialogTitle>
          <StoreAppHeader title="Estudio de vídeos" onBack={close}/>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
          {error ? (
            <p
              role="alert"
              className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {bridge && <StudioSteps current={panel} complete={Boolean(selected?.result) && !dirty} />}
          {!bridge ? (
            <div className="grid items-start gap-6 md:grid-cols-2">
              <section>
                <h2 className="text-xl font-semibold">Vídeos verticales con narración</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Escribe una idea, revisa el guion y escucha la narración antes de exportar el MP4.
                  Para crear y guardar vídeos, abre el Estudio en Mycellios Desktop en tu PC Windows.
                </p>
                <div className="mt-3"><DesktopDownloadLink inAccountMenu /></div>
              </section>
              <VideoStudioSample />
            </div>
          ) : !selected ? (
            <div className="grid items-start gap-6 md:grid-cols-2 md:gap-8">
              <section>
                <h2 className="mb-2 text-2xl font-semibold">De una idea a un vídeo</h2>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                  Escribe un tema, prepara el guion y revisa las escenas con voz antes de descargar tu vídeo.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform("Creando proyecto…", async () => {
                      const p = update(await request({ action: "create", topic }));
                      select(p);
                      setTopic("");
                    });
                  }}
                >
                  <label htmlFor="studio-topic" className="mb-2 block text-sm font-medium">
                    Tema del vídeo
                  </label>
                  <Textarea
                    id="studio-topic"
                    value={topic}
                    maxLength={1000}
                    rows={4}
                    required
                    minLength={3}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Por ejemplo, tres formas de ahorrar agua en casa"
                  />
                  <Button className="mt-4" type="submit" disabled={blocked || topic.trim().length < 3}>
                    Crear proyecto
                  </Button>
                  <details className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    <summary className="cursor-pointer">Cómo se ejecuta en tu PC</summary>
                    <p className="mt-2">
                      Los proyectos se guardan en este equipo. Puedes usar tu sesión de Codex para el
                      guion y las voces de Windows para narrarlo. Se aplican los límites de tu
                      proveedor de Codex. El estudio funciona sin créditos de Mycellios y requiere el PC.
                    </p>
                  </details>
                </form>
              </section>
              <div>
                <VideoStudioSample />
                {projects.length ? (
                  <section className="mt-5">
                    <h2 className="mb-3 text-sm font-semibold">Tus proyectos en este PC</h2>
                    <div className="space-y-2">
                      {projects.map((p) => (
                        <Button
                          key={p.id}
                          variant="ghost"
                          className="h-auto w-full justify-start whitespace-normal rounded-xl border border-border p-4 text-start"
                          onClick={() => select(p)}
                        >
                          <span>
                            <span className="block font-medium">{p.topic}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {p.result ? "Vídeo listo" : steps[progress(p)]} · revisión {p.revision}
                            </span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <h2 className="mb-2 text-xl font-semibold">{selected.topic}</h2>
              <p className="mb-6 text-xs text-muted-foreground">
                Guardado en este PC · versión fija 1.0.0 · revisión {selected.revision}
              </p>
              {selected.result && !dirty ? (
                <section className="mb-6 max-w-xl rounded-xl bg-success/10 p-4">
                  <h3 className="mb-3 font-semibold">Tu MP4 está listo</h3>
                  {video ? (
                    <>
                      <video controls src={video} className="max-h-96 w-full rounded-xl bg-black" />
                      <a
                        href={video}
                        download="mycellios-video.mp4"
                        className="mt-3 inline-block underline underline-offset-4"
                      >
                        Descargar MP4
                      </a>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={blocked}
                      onClick={() =>
                        void perform("Abriendo vídeo…", async () => {
                          const url = await artifactUrl(selected, "video");
                          if (alive.current) setVideo(url);
                        })
                      }
                    >
                      Abrir vídeo guardado
                    </Button>
                  )}
                  <p className="mt-3 text-sm text-muted-foreground">
                    {selected.result.duration.toFixed(1)} s · 720 × 1280 · imagen y audio
                    comprobados. No se ha publicado en redes.
                  </p>
                </section>
              ) : null}
              {!selected.scenes.length ? (
                <div className="max-w-lg">
                  <p className="mb-5 text-sm text-muted-foreground">
                    Genera seis escenas cortas con tu sesión de Codex, o escribe el guion. No se
                    ejecutan las instrucciones del tema como código.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      disabled={blocked}
                      onClick={() =>
                        void perform("Generando el guion con Codex…", async () => {
                          const p = update(
                            await request({
                              action: "script",
                              id: selected.id,
                              revision: selected.revision,
                            }),
                          );
                          setPreview(videoStudioFrames(p.scenes));
                        })
                      }
                    >
                      Generar guion
                    </Button>
                    <Button
                      variant="outline"
                      disabled={blocked}
                      onClick={() => {
                        setScenes(Array.from({ length: 6 }, () => ({ title: "", narration: "" })));
                        setDirty(true);
                      }}
                    >
                      Escribir guion
                    </Button>
                  </div>
                </div>
              ) : null}
              {scenes.length ? (
                <>
                  <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {scenes.map((scene, index) => (
                      <Card key={index}>
                        <CardContent className="p-4">
                          <p className="mb-3 text-xs font-medium text-muted-foreground">
                            ESCENA {index + 1}
                          </p>
                          <label className="mb-2 block text-sm" htmlFor={`scene-title-${index}`}>
                            Título
                          </label>
                          <Input
                            id={`scene-title-${index}`}
                            value={scene.title}
                            maxLength={80}
                            disabled={blocked}
                            onChange={(e) => {
                              setScenes((current) =>
                                current.map((s, i) =>
                                  i === index ? { ...s, title: e.target.value } : s,
                                ),
                              );
                              setDirty(true);
                              setReviewed(false);
                            }}
                          />
                          <label
                            className="mb-2 mt-3 block text-sm"
                            htmlFor={`scene-voice-${index}`}
                          >
                            Narración
                          </label>
                          <Textarea
                            id={`scene-voice-${index}`}
                            rows={4}
                            value={scene.narration}
                            maxLength={260}
                            disabled={blocked}
                            onChange={(e) => {
                              setScenes((current) =>
                                current.map((s, i) =>
                                  i === index ? { ...s, narration: e.target.value } : s,
                                ),
                              );
                              setDirty(true);
                              setReviewed(false);
                            }}
                          />
                          {preview[index] ? (
                            <img
                              src={preview[index]}
                              alt={`Composición de la escena ${index + 1}`}
                              className="mx-auto mt-4 max-h-48 rounded-lg"
                            />
                          ) : null}
                          {audio[index] ? (
                            <audio
                              controls
                              src={audio[index]}
                              aria-label={`Narración de la escena ${index + 1}`}
                              className="mt-3 w-full"
                            />
                          ) : null}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {dirty ? (
                      <Button
                        disabled={
                          blocked || scenes.some((s) => !s.title.trim() || !s.narration.trim())
                        }
                        onClick={() =>
                          void perform("Guardando guion…", async () => {
                            const p = update(
                              await request({
                                action: "save",
                                id: selected.id,
                                revision: selected.revision,
                                scenes,
                              }),
                            );
                            setPreview(videoStudioFrames(p.scenes));
                            setAudio([]);
                            setVideo("");
                          })
                        }
                      >
                        Guardar guion
                      </Button>
                    ) : null}
                    {dirty ? <Button variant="ghost" disabled={blocked} onClick={() => { setScenes(selected.scenes); setDirty(false); setPreview(selected.scenes.length ? videoStudioFrames(selected.scenes) : []); }}>Cancelar edición</Button> : null}
                    <Button
                      variant="outline"
                      disabled={blocked || dirty}
                      onClick={() =>
                        void perform("Preparando voz e imágenes…", async () => {
                          const frames = videoStudioFrames(selected.scenes);
                          let p = selected;
                          if (p.previewRevision !== p.revision)
                            p = update(
                              await request({
                                action: "preview",
                                id: selected.id,
                                revision: selected.revision,
                                frames,
                              }),
                            );
                          if (p.voiceRevision !== p.revision)
                            p = update(
                              await request({ action: "voice", id: p.id, revision: p.revision }),
                            );
                          const sounds = [];
                          const images = [];
                          for (let i = 0; i < 6; i++) sounds.push(await artifactUrl(p, "voice", i));
                          for (let i = 0; i < 6; i++) images.push(await artifactUrl(p, "image", i));
                          if (alive.current) {
                            setAudio(sounds);
                            setPreview(images);
                            setReviewed(false);
                          }
                        })
                      }
                    >
                      {selected.voiceRevision === selected.revision
                        ? "Escuchar y revisar"
                        : "Preparar voz e imágenes"}
                    </Button>
                  </div>
                  {audio.length === 6 && !dirty ? (
                    <section className="mt-6 max-w-xl rounded-xl bg-card p-5">
                      <h3 className="font-medium">Revisión antes de renderizar</h3>
                      <p className="my-3 text-sm text-muted-foreground">
                        Escucha las seis narraciones y revisa las composiciones. Esta versión usa
                        una voz española instalada en Windows y escenas tipográficas, sin música ni
                        ilustraciones generadas.
                      </p>
                      <Button
                        variant={reviewed ? "secondary" : "outline"}
                        aria-pressed={reviewed}
                        disabled={blocked}
                        onClick={() => setReviewed((v) => !v)}
                      >
                        {reviewed
                          ? "Revisión confirmada"
                          : "He revisado la voz y las seis imágenes"}
                      </Button>
                      <Button
                        className="mt-4"
                        disabled={!reviewed || blocked}
                        onClick={() =>
                          void perform("Renderizando y comprobando el MP4…", async () => {
                            let p = update(
                              await request({
                                action: "approve",
                                id: selected.id,
                                revision: selected.revision,
                              }),
                            );
                            p = update(
                              await request({ action: "render", id: p.id, revision: p.revision }),
                            );
                            const url = await artifactUrl(p, "video");
                            if (alive.current) setVideo(url);
                          })
                        }
                      >
                        Crear vídeo
                      </Button>
                    </section>
                  ) : null}
                </>
              ) : null}
              <details className="mt-7 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Detalles del proyecto</summary>
                <p className="mt-2 break-all">
                  {selected.appId} · definición {selected.definitionHash}
                </p>
                <p className="mt-2">
                  Codex: consumo de la cuenta del PC, coste externo sin medir. Render: CPU local,
                  sin coste de servidor. Los proyectos aún no se sincronizan con otros dispositivos.
                </p>
                {selected.modelUsage ? (
                  <p className="mt-2">
                    Consumo comunicado por Codex: {selected.modelUsage.inputTokens} tokens de
                    entrada y {selected.modelUsage.outputTokens} de salida.
                  </p>
                ) : null}
              </details>
            </>
          )}
        </div>
        {busy || selected?.activeStep ? (
          <div
            className="flex items-center justify-between gap-3 border-t border-border p-4"
            role="status"
          >
            <span className="flex items-center gap-2 text-sm">
              <LoaderCircle className="animate-spin motion-reduce:animate-none" size={16} />
              {busy ??
                {
                  script: "Generando guion…",
                  voice: "Generando narración…",
                  render: "Renderizando vídeo…",
                }[selected!.activeStep!.action]}
            </span>
            {selected ? (
              <Button
                variant="ghost"
                onClick={() => {
                  void request({ action: "cancel", id: selected.id }).catch((e) =>
                    setError(message(e)),
                  );
                }}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
