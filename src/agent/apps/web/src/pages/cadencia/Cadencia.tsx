import { CutReview } from "./CutReview";
import { Button, Input } from "@rakazo/ui-web";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileVideo,
  Headphones,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { setUnsavedEditorWork } from "../../lib/unsaved-editor-work";
import { appPath } from "../../lib/app-path";
import {
  ANALYSIS_RATE,
  auditionPcm,
  keptSegments,
  selectedCuts,
  sourceTime,
  type Analysis,
  type Cut,
} from "./analysis";
import { createDemo, readMedia, renderMedia, stopError } from "./media";
import {
  blankState,
  readCadencia,
  saveCadencia,
  type CadenciaState,
} from "./state";
import "./cadencia.css";

const seconds = (value: number) => `${value.toFixed(2).replace(".", ",")} s`;
const clock = (value: number) =>
  `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export default function Cadencia({
  scope,
  onBack,
}: {
  scope: string;
  onBack: () => void;
}) {
  const [state, setState] = useState(() => readCadencia(scope));
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<"before" | "after">("before");
  const [active, setActive] = useState<string | null>(null),
    [audition, setAudition] = useState("");
  const [position, setPosition] = useState(0),
    [advanced, setAdvanced] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null),
    media = useRef<HTMLVideoElement>(null);
  const operation = useRef<AbortController | null>(null),
    worker = useRef<Worker | null>(null);
  const auditionGeneration = useRef(0);
  const sound = useRef<AudioContext | null>(null),
    alive = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    const key = `cadencia-operation:${scope}`;
    setUnsavedEditorWork(key, !!busy);
    return () => setUnsavedEditorWork(key, false);
  }, [scope, busy]);
  const sourceUrl = useBlobUrl(state.file),
    resultUrl = useBlobUrl(state.rendered?.blob);
  useEffect(() => {
    saveCadencia(scope, state);
  }, [scope, state]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      auditionGeneration.current++;
      operation.current?.abort();
      worker.current?.terminate();
      void sound.current?.close().catch(() => {});
    };
  }, []);
  const validation = useMemo(() => {
    if (!state.info) return { saved: 0, error: "" };
    try {
      const cuts = selectedCuts(state.cuts, state.info.duration);
      return {
        saved: cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0),
        error: "",
      };
    } catch (cause) {
      return {
        saved: 0,
        error: cause instanceof Error ? cause.message : "Revisa los cortes.",
      };
    }
  }, [state.cuts, state.info]);
  const selected = state.cuts.filter((cut) => cut.enabled).length;
  const invalidate = (patch: Partial<CadenciaState>) => {
    auditionGeneration.current++;
    media.current?.pause();
    void sound.current?.close().catch(() => {});
    sound.current = null;
    setAudition("");
    setMode("before");
    setState((previous) => ({ ...previous, ...patch, rendered: undefined }));
  };
  async function work(
    label: string,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
    if (pending.current) return;
    auditionGeneration.current++;
    pending.current = true;
    setBusy(label);
    setProgress(0);
    setError("");
    media.current?.pause();
    await sound.current?.close().catch(() => {});
    sound.current = null;
    setAudition("");
    const controller = new AbortController();
    operation.current = controller;
    try {
      await action(controller.signal);
    } catch (cause) {
      if (alive.current && !controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "No se pudo procesar este archivo.",
        );
    } finally {
      pending.current = false;
      if (operation.current === controller) operation.current = null;
      if (alive.current) setBusy("");
    }
  }
  async function runAnalysis(
    pcm: Float32Array,
    signal: AbortSignal,
    settings = state.settings,
  ): Promise<Analysis> {
    return new Promise((resolve, reject) => {
      const job = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = job;
      const finish = () => {
        signal.removeEventListener("abort", cancel);
        job.terminate();
        if (worker.current === job) worker.current = null;
      };
      const cancel = () => {
        finish();
        reject(stopError());
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      job.onmessage = (event) => {
        if (event.data.result) {
          finish();
          resolve(event.data.result);
        } else if (event.data.error) {
          finish();
          reject(new Error(event.data.error));
        } else if (alive.current)
          setProgress(0.55 + event.data.progress * 0.45);
      };
      job.onerror = () => {
        finish();
        reject(
          new Error(
            "No se pudo iniciar el análisis local. Recarga Cadencia y vuelve a intentarlo.",
          ),
        );
      };
      // Transfer a copy; the owner's analysis PCM stays intact for auditioning.
      const copy = pcm.slice();
      job.postMessage({ pcm: copy, settings }, [copy.buffer]);
    });
  }
  async function load(file: File, signal: AbortSignal, demo = false) {
    if (alive.current) setBusy("Leyendo el audio del archivo…");
    const decoded = await readMedia(file, signal, (fraction) => {
      if (alive.current) setProgress(fraction * 0.55);
    });
    if (alive.current) setBusy("Buscando pausas y sonidos sostenidos…");
    const analysis = await runAnalysis(decoded.pcm, signal);
    if (alive.current && !signal.aborted) {
      setMode("before");
      setPosition(0);
      setActive(analysis.cuts[0]?.id ?? null);
      setState({
        ...blankState(),
        settings: { ...state.settings },
        file,
        ...decoded,
        analysis,
        cuts: analysis.cuts,
        demo,
      });
    }
  }
  const importFile = (file: File) =>
    void work("Abriendo el archivo…", (signal) => load(file, signal));
  async function playCut(cut: Cut, edited: boolean) {
    if (!state.pcm || !state.info || busy) return;
    const generation = ++auditionGeneration.current;
    media.current?.pause();
    await sound.current?.close().catch(() => {});
    if (!alive.current || generation !== auditionGeneration.current) return;
    sound.current = null;
    setAudition("");
    setError("");
    try {
      if (edited)
        selectedCuts([{ ...cut, enabled: true }], state.info.duration);
      const pcm = auditionPcm(
        state.pcm,
        cut.start - 0.7,
        cut.end + 0.7,
        edited
          ? state.cuts.map((c) =>
              c.id === cut.id ? { ...c, enabled: true } : c,
            )
          : [],
      );
      const context = new AudioContext({ sampleRate: ANALYSIS_RATE });
      sound.current = context;
      await context.resume();
      if (!alive.current || generation !== auditionGeneration.current) {
        await context.close();
        return;
      }
      const buffer = context.createBuffer(1, pcm.length, ANALYSIS_RATE);
      buffer.getChannelData(0).set(pcm);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      setActive(cut.id);
      setAudition(`${cut.id}:${edited ? "after" : "before"}`);
      source.onended = () => {
        if (sound.current === context) {
          sound.current = null;
          if (alive.current) setAudition("");
          void context.close().catch(() => {});
        }
      };
      source.start();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo reproducir el corte.",
      );
    }
  }
  function changeCut(id: string, patch: Partial<Cut>) {
    invalidate({
      cuts: state.cuts.map((cut) =>
        cut.id === id ? { ...cut, ...patch } : cut,
      ),
    });
  }
  function seek(cut: Cut) {
    setActive(cut.id);
    setMode("before");
    if (media.current) {
      media.current.pause();
      media.current.currentTime = Math.max(0, cut.start - 0.7);
    }
  }
  const total = state.info?.duration ?? 0;
  const waveformMax = useMemo(
    () => Math.max(0.01, ...(state.analysis?.peaks ?? [])),
    [state.analysis],
  );
  const sourcePosition =
    mode === "after" && state.info && !validation.error
      ? sourceTime(keptSegments(state.cuts, total), position)
      : position;
  const showDuration =
    mode === "after" && state.rendered ? state.rendered.duration : total;
  return (
    <section className="cd-app" aria-label="Cadencia">
      <header className="cd-header">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={15} /> Hifa Store
          </Button>
          <h1>
            Cadencia<span>Tu voz, a su ritmo.</span>
          </h1>
        </div>
        <span className="cd-private">
          <ShieldCheck size={15} /> Solo en este navegador
        </span>
      </header>
      <input
        ref={filePicker}
        type="file"
        accept="video/*,audio/*,.mp4,.mov,.webm,.wav,.m4a,.mp3"
        hidden
        aria-label="Seleccionar vídeo o audio"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) importFile(file);
        }}
      />
      {error && (
        <p className="cd-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <div className="cd-progress" role="status">
          <div>
            <strong>{busy}</strong>
            <span>{Math.round(progress * 100)} %</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => operation.current?.abort()}
            >
              <X size={14} /> Cancelar
            </Button>
          </div>
          <progress
            value={progress}
            max={1}
            aria-label="Progreso del procesamiento"
          />
        </div>
      )}
      {!state.file ? (
        <div
          className="cd-empty"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file && !busy) importFile(file);
          }}
        >
          <div className="cd-empty-mark" aria-hidden="true">
            {[24, 44, 80, 60, 112, 72, 36, 58, 92, 50, 28].map(
              (height, index) => (
                <span key={index} style={{ height }} />
              ),
            )}
          </div>
          <h2>
            Menos pausas.
            <br />
            Más intención.
          </h2>
          <p>
            Recorta silencios y revisa vocales sostenidas.
            <br />
            Escucha cada cambio antes de quedártelo.
          </p>
          <Button disabled={!!busy} onClick={() => filePicker.current?.click()}>
            <Upload size={16} /> Elegir vídeo
          </Button>
          <Button
            variant="ghost"
            disabled={!!busy}
            onClick={() =>
              void work("Preparando la demo…", async (signal) => {
                const response = await fetch(appPath("/cadencia/demo.wav"), {
                  signal,
                });
                if (!response.ok)
                  throw new Error(
                    "No se pudo cargar la demostración. Puedes elegir tu propio vídeo.",
                  );
                const file = await createDemo(await response.blob(), signal);
                await load(file, signal, true);
              })
            }
          >
            Probar con la demo <ArrowRight size={14} />
          </Button>
          <small>
            Vídeo o audio · hasta 5 min y 250 MB
            <br />
            El archivo se procesa aquí. No se sube a un servidor.
          </small>
        </div>
      ) : (
        <>
          <div className="cd-projectbar">
            <span>
              <FileVideo size={16} />
              <strong>{state.file.name}</strong>
              {state.demo && (
                <span className="cd-demo-label">Demo sintetizada</span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!!busy}
              onClick={() => filePicker.current?.click()}
            >
              Otro archivo
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cerrar archivo"
              disabled={!!busy}
              onClick={() => setClosing((value) => !value)}
            >
              <X size={14} />
            </Button>
          </div>
          {closing && (
            <div className="cd-close-confirm" role="alert">
              <span>
                ¿Cerrar el archivo y descartar los ajustes? El original y tus
                descargas se conservan.
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  invalidate({
                    ...blankState(),
                    file: undefined,
                    info: undefined,
                    pcm: undefined,
                    analysis: undefined,
                  });
                  setActive(null);
                  setPosition(0);
                  setError("");
                  setClosing(false);
                }}
              >
                Cerrar y descartar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setClosing(false)}
              >
                Conservar
              </Button>
            </div>
          )}
          <div className="cd-layout">
            <div className="cd-view">
              <div className="cd-player-tools">
                <div role="group" aria-label="Comparar vídeo">
                  <Button
                    variant="ghost"
                    aria-pressed={mode === "before"}
                    onClick={() => {
                      media.current?.pause();
                      setMode("before");
                      setPosition(0);
                    }}
                  >
                    Antes
                  </Button>
                  <Button
                    variant="ghost"
                    aria-pressed={mode === "after"}
                    disabled={!state.rendered}
                    onClick={() => {
                      media.current?.pause();
                      setMode("after");
                      setPosition(0);
                    }}
                  >
                    Después
                  </Button>
                </div>
                <span>{clock(showDuration)}</span>
              </div>
              <div
                className={`cd-player ${!state.info?.video ? "cd-player-audio" : ""}`}
              >
                <video
                  ref={media}
                  key={`${sourceUrl}:${mode}:${resultUrl}`}
                  src={(mode === "after" ? resultUrl : sourceUrl) || undefined}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={
                    mode === "after" ? "Vídeo editado" : "Vídeo original"
                  }
                  onTimeUpdate={(event) =>
                    setPosition(event.currentTarget.currentTime)
                  }
                  onPlay={() => {
                    auditionGeneration.current++;
                    void sound.current?.close().catch(() => {});
                    sound.current = null;
                    setAudition("");
                  }}
                />
                {!state.info?.video && (
                  <span>
                    <Headphones size={24} /> Archivo de audio
                  </span>
                )}
              </div>
              <div
                className="cd-waveform"
                aria-label="Forma de onda del audio original"
              >
                <svg
                  viewBox="0 0 640 96"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Audio original y regiones propuestas para recortar"
                >
                  {state.analysis?.peaks.map((peak, i) => {
                    const max = waveformMax;
                    const h = Math.max(2, Math.sqrt(peak / max) * 76);
                    return (
                      <line
                        key={i}
                        x1={i}
                        x2={i}
                        y1={48 - h / 2}
                        y2={48 + h / 2}
                        className="cd-wave"
                      />
                    );
                  })}
                  {state.cuts.map((cut) => (
                    <rect
                      key={cut.id}
                      x={(cut.start / total) * 640}
                      width={Math.max(1, ((cut.end - cut.start) / total) * 640)}
                      y={0}
                      height={96}
                      className={`cd-region cd-region-${cut.kind} ${cut.enabled ? "is-selected" : ""}`}
                    />
                  ))}
                  <line
                    x1={(sourcePosition / Math.max(0.01, total)) * 640}
                    x2={(sourcePosition / Math.max(0.01, total)) * 640}
                    y1={0}
                    y2={96}
                    className="cd-playhead"
                  />
                </svg>
                <div>
                  <span>Original · {clock(total)}</span>
                  <span className="cd-legend">
                    <i /> Silencios <i /> Posibles vocales
                  </span>
                </div>
              </div>
              <div className="cd-summary">
                <div>
                  <strong>
                    {selected
                      ? `${seconds(validation.saved)} menos`
                      : "El original se conserva"}
                  </strong>
                  <span>
                    {selected}{" "}
                    {selected === 1
                      ? "corte seleccionado"
                      : "cortes seleccionados"}{" "}
                    · {clock(total)} <ArrowRight size={12} />{" "}
                    {clock(Math.max(0, total - validation.saved))}
                  </span>
                </div>
                {state.rendered ? (
                  <Button
                    render={
                      <a
                        href={resultUrl}
                        download={`cadencia-${state.file.name.replace(/\.[^.]+$/, "")}.${state.rendered.extension}`}
                      />
                    }
                  >
                    <Download size={16} /> Descargar {state.rendered.format}
                  </Button>
                ) : (
                  <Button
                    disabled={!!busy || !selected || !!validation.error}
                    onClick={() =>
                      void work(
                        "Creando la versión editada…",
                        async (signal) => {
                          const result = await renderMedia(
                            state.file!,
                            state.cuts,
                            signal,
                            (value) => {
                              if (alive.current) setProgress(value);
                            },
                          );
                          if (alive.current && !signal.aborted) {
                            setState((previous) => ({
                              ...previous,
                              rendered: result,
                            }));
                            setMode("after");
                            setPosition(0);
                          }
                        },
                      )
                    }
                  >
                    <Scissors size={15} /> Crear versión editada
                  </Button>
                )}
              </div>
              {validation.error && (
                <p role="alert" className="cd-error">
                  {validation.error}
                </p>
              )}
              <p className="cd-footnote">
                Exportación local · hasta 720p / 30 fps. MP4 cuando el navegador
                lo permite; WebM como alternativa. El original nunca se
                modifica.
              </p>
              <details
                className="cd-settings"
                open={advanced}
                onToggle={(event) => setAdvanced(event.currentTarget.open)}
              >
                <summary>
                  <SlidersHorizontal size={14} /> Ajustar detección
                </summary>
                <div>
                  <label>
                    Pausa mínima{" "}
                    <Input
                      aria-label="Pausa mínima en milisegundos"
                      type="number"
                      min={200}
                      max={2000}
                      step={50}
                      value={Math.round(state.settings.minimumSilence * 1000)}
                      disabled={!!busy}
                      onChange={(event) =>
                        setState((s) => ({
                          ...s,
                          settings: {
                            ...s.settings,
                            minimumSilence: Number(event.target.value) / 1000,
                          },
                        }))
                      }
                    />
                    <small>ms</small>
                  </label>
                  <label>
                    Margen de voz{" "}
                    <Input
                      aria-label="Margen de voz en milisegundos"
                      type="number"
                      min={20}
                      max={200}
                      step={10}
                      value={Math.round(state.settings.margin * 1000)}
                      disabled={!!busy}
                      onChange={(event) =>
                        setState((s) => ({
                          ...s,
                          settings: {
                            ...s.settings,
                            margin: Number(event.target.value) / 1000,
                          },
                        }))
                      }
                    />
                    <small>ms</small>
                  </label>
                  <label>
                    Sonido sostenido mínimo{" "}
                    <Input
                      aria-label="Duración mínima de vocal en milisegundos"
                      type="number"
                      min={500}
                      max={2000}
                      step={50}
                      value={Math.round(state.settings.minimumVowel * 1000)}
                      disabled={!!busy}
                      onChange={(event) =>
                        setState((s) => ({
                          ...s,
                          settings: {
                            ...s.settings,
                            minimumVowel: Number(event.target.value) / 1000,
                          },
                        }))
                      }
                    />
                    <small>ms</small>
                  </label>
                  <Button
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void work("Reanalizando el audio…", async (signal) => {
                        const analysis = await runAnalysis(state.pcm!, signal);
                        if (alive.current && !signal.aborted) {
                          invalidate({ analysis, cuts: analysis.cuts });
                          setActive(analysis.cuts[0]?.id ?? null);
                        }
                      })
                    }
                  >
                    Volver a detectar
                  </Button>
                </div>
                <p>
                  La detección de vocales es acústica y orientativa. No reconoce
                  palabras; revisa los sonidos expresivos, la música y el ruido
                  antes de recortarlos.
                </p>
              </details>
            </div>
            <CutReview
              cuts={state.cuts}
              total={total}
              busy={busy}
              active={active}
              audition={audition}
              error={validation.error}
              onClear={() =>
                invalidate({
                  cuts: state.cuts.map((c) => ({ ...c, enabled: false })),
                })
              }
              onSelect={seek}
              onChange={changeCut}
              onPlay={playCut}
              onStop={() => {
                auditionGeneration.current++;
                void sound.current?.close().catch(() => {});
                sound.current = null;
                setAudition("");
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}
