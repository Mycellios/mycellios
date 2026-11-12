import type { Bot, HostedWebCard, HostedWebDraft } from "@rakazo/contracts";
import { Button, Input } from "@rakazo/ui-web";
import {
  ArrowLeft,
  ArrowUpRight,
  Code2,
  Copy,
  Eye,
  Globe2,
  Pin,
  Plus,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { matches } from "./catalog";
import { appPath } from "../../lib/app-path";
import {
  clearWebEditor,
  readWebEditor,
} from "../../lib/hosted-web-editor-state";
import { createSpaceRpc, selectedSpaceId } from "../../lib/rpc";
import "./hosted-webs.css";
import { FirstPartyApps, matchingFirstPartyApps } from "./FirstPartyApps";
import { WebEditor } from "./HostedWebEditor";
import { encode, issue, publishedWebPath } from "./hosted-web-files";

type Filter = "discover" | "trending" | "pinned" | "mine";
const VideoEditor = lazy(() => import("./VideoEditor").then(module => ({default: module.VideoEditor})));
const MycelliosCreate = lazy(() => import("./MycelliosCreate").then(module => ({default: module.MycelliosCreate})));
const Cadencia = lazy(() => import("../cadencia/Cadencia"));
const starter = `<!doctype html>\n<html lang="es">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Mi web</title>\n<style>body{font:18px system-ui;background:#f7f5ef;color:#243e2c;max-width:760px;margin:80px auto;padding:24px}h1{font-size:48px;letter-spacing:-.03em}</style>\n<h1>Una idea con su propio espacio.</h1>\n<p>Edita esta web o sube los archivos que has creado con tu Mico.</p>\n</html>`;
export function HostedWebs({
  scope,
  spaceId,
  bots,
  onOpenStudio,
  activeBotId,
  onOpenBot,
  onCreateBot,
}: {
  scope: string;
  spaceId?: string | null;
  bots: Bot[];
  activeBotId?: string;
  onOpenStudio?: () => void;
  onOpenBot: (id: string) => void;
  onCreateBot: () => void;
}) {
  // Pin every async operation to the Space that mounted this workspace.
  const client = useMemo(
    () => createSpaceRpc(spaceId ?? selectedSpaceId()),
    [scope, spaceId],
  );
  const [filter, setFilter] = useState<Filter>("discover");
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const cadenciaMatch =
    filter === "discover" &&
    matches(
      query,
      "Cadencia",
      "recortar silencios vocales alargadas voz audio vídeo",
    );
  const firstPartyMatch = filter === "discover" && matchingFirstPartyApps(query).length > 0;
  const openTool = (app?: string) => {
    const next = new URLSearchParams(params);
    if (app) next.set("app", app); else next.delete("app");
    setParams(next);
  };
  const openCadencia = () => {
    const next = new URLSearchParams(params);
    next.set("app", "cadencia");
    setParams(next);
  };
  const [rows, setRows] = useState<HostedWebCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<HostedWebDraft | null>(
    () => readWebEditor(scope)?.draft ?? null,
  );
  const [open, setOpen] = useState<HostedWebCard | null>(null);
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () => {
        void client.webs
          .list({ filter, query })
          .then((result) => {
            if (active) setRows(result);
          })
          .catch((error) => {
            if (active) setError(issue(error));
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, filter, query, refresh]);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      if (alive.current) setError(issue(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const edit = (id: string) =>
    act(async () => {
      const next = await client.webs.draft({ id });
      if (alive.current) {
        setOpen(null);
        setDraft(next);
      }
    });
  const create = () => {
    const id = crypto.randomUUID();
    setError("");
    setOpen(null);
    setDraft({
      id,
      version: 0,
      slug: `web-${id.slice(0, 8)}`,
      title: "Mi web",
      summary: "",
      bundle: { files: [{ path: "index.html", base64: encode(starter) }] },
      published: false,
    });
  };
  const antseed = () =>
    act(async () => {
      const next = await client.webs.antseed({ id: crypto.randomUUID() });
      if (alive.current) {
        setDraft(next);
        setRefresh((value) => value + 1);
      }
    });
  const clone = (id: string) =>
    act(async () => {
      const next = await client.webs.clone({ id, newId: crypto.randomUUID() });
      if (alive.current) {
        setOpen(null);
        setDraft(next);
        setRefresh((value) => value + 1);
      }
    });
  if (params.get("app") === "video-edit") return <Suspense fallback={<p role="status">Abriendo editor…</p>}><VideoEditor onBack={() => openTool()} /></Suspense>;
  if (params.get("app") === "create") return <Suspense fallback={<p role="status">Abriendo creación…</p>}><MycelliosCreate onBack={() => openTool()} /></Suspense>;
  if (params.get("app") === "cadencia")
    return (
      <Suspense
        fallback={
          <p role="status" className="hw-status">
            Abriendo Cadencia…
          </p>
        }
      >
        <Cadencia
          scope={scope}
          onBack={() => {
            const next = new URLSearchParams(params);
            next.delete("app");
            setParams(next);
          }}
        />
      </Suspense>
    );
  if (draft)
    return (
      <WebEditor
        scope={scope}
        key={draft.id}
        initial={draft}
        bots={bots}
        onOpenBot={onOpenBot}
        onCreateBot={onCreateBot}
        spaceId={spaceId ?? selectedSpaceId()}
        client={client}
        onBack={() => {
          clearWebEditor(scope);
          setDraft(null);
          setRefresh((value) => value + 1);
        }}
        onPublished={() => setRefresh((value) => value + 1)}
      />
    );
  return (
    <section className="hw-directory" aria-labelledby="webs-title">
      {open ? (
        <>
          <header className="hw-view-bar">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(null);
                setRefresh((value) => value + 1);
              }}
            >
              <ArrowLeft /> Hifa Store
            </Button>
            <strong>{open.title}</strong>
            <div className="hw-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void clone(open.id)}
              >
                <Copy /> Clonar
              </Button>
              {open.owned && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void edit(open.id)}
                >
                  <Code2 /> Editar
                </Button>
              )}
              <Button
                variant="secondary"
                render={
                  <a
                    href={publishedWebPath(open.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ArrowUpRight /> Abrir web
              </Button>
            </div>
          </header>
          {error && (
            <p className="hw-error" role="alert">
              {error}
            </p>
          )}
          <iframe
            className="hw-site-frame"
            title={open.title}
            src={publishedWebPath(open.slug)}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
          {open.title === "Antseed Radar" && (
            <p className="hw-source">
              Datos públicos de Antseed.{" "}
              <a
                href="https://antseed.com/docs/api/routing/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver la fuente y sus límites <ArrowUpRight size={12} />
              </a>
            </p>
          )}
        </>
      ) : (
        <>
          <header className="rk-market-heading hw-heading">
            <div>
              <h1 id="webs-title">Hifa Store</h1>
              <p>
                Crea con tus Micos. Abre, comparte y haz tuyas las apps de la
                comunidad.
              </p>
            </div>
            <div className="hw-actions"><Button variant="secondary" onClick={() => openTool("create")}>Crear imagen, voz o vídeo</Button><Button onClick={create}>
              <Plus /> Crear app
            </Button></div>
          </header>
          <div className="hw-toolbar">
            <nav aria-label="Explorar apps">
              {(
                [
                  ["discover", "Explorar"],
                  ["trending", "Tendencias"],
                  ["pinned", "Fijadas"],
                  ["mine", "Mis apps"],
                ] as const
              ).map(([id, label]) => (
                <Button
                  key={id}
                  variant="ghost"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </Button>
              ))}
            </nav>
            <Input
              type="search"
              aria-label="Buscar apps"
              placeholder="Buscar apps…"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {error && (
            <div className="hw-error" role="alert">
              {error}{" "}
              <Button
                variant="secondary"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Reintentar
              </Button>
            </div>
          )}
          {loading && (
            <p className="hw-status" role="status">
              Cargando apps…
            </p>
          )}
          {(
              <>
                {filter === "trending" && (
                  <p className="hw-caption">
                    Ordenadas por visitas distintas en los últimos 7 días.
                  </p>
                )}
                {(!error && rows.length) ||
                cadenciaMatch ||
                firstPartyMatch ? (
                  <div className="hw-grid">
                    {cadenciaMatch && (
                      <article className="hw-card">
                        <button
                          type="button"
                          className="hw-cover hw-cadencia-cover"
                          onClick={openCadencia}
                          aria-label="Abrir Cadencia"
                        >
                          <span className="hw-cadencia-mark" aria-hidden="true">
                            {[18, 33, 52, 34, 22, 43, 28].map((height, i) => (
                              <i key={i} style={{ height }} />
                            ))}
                          </span>
                          <span>Cadencia</span>
                          <ArrowUpRight size={20} />
                        </button>
                        <div className="hw-card-body">
                          <div className="hw-card-title">
                            <h2>Cadencia</h2>
                          </div>
                          <p>
                            Recorta silencios y revisa vocales alargadas.
                            Escucha el antes y después.
                          </p>
                          <div className="hw-card-footer">
                            <span>
                              <Globe2 size={13} /> En este navegador · privado
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={openCadencia}
                            >
                              Abrir
                            </Button>
                          </div>
                        </div>
                      </article>
                    )}
                    {filter === "discover" && <FirstPartyApps query={query} bots={bots} scope={scope}
                      activeBotId={activeBotId} onOpenEdit={() => openTool("video-edit")} onOpenStudio={onOpenStudio} />}

                    {!error && rows.map((row) => (
                      <article className="hw-card" key={row.id}>
                        <button
                          type="button"
                          className={`hw-cover ${row.title === "Antseed Radar" ? "hw-antseed" : ""}`}
                          onClick={() =>
                            row.published ? setOpen(row) : void edit(row.id)
                          }
                          aria-label={`${row.published ? "Abrir" : "Editar"} ${row.title}`}
                        >
                          {row.title === "Antseed Radar" ? (
                            <>
                              <span
                                className="hw-radar-mark"
                                aria-hidden="true"
                              >
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                              </span>
                              <span>
                                Antseed
                                <br />
                                <b>Radar</b>
                              </span>
                              <ArrowUpRight size={20} />
                            </>
                          ) : (
                            <>
                              <Globe2 size={38} strokeWidth={1.2} />
                              <span>{row.title}</span>
                              <ArrowUpRight size={20} />
                            </>
                          )}
                        </button>
                        <div className="hw-card-body">
                          <div className="hw-card-title">
                            <h2>{row.title}</h2>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={
                                row.pinned
                                  ? `Desfijar ${row.title}`
                                  : `Fijar ${row.title}`
                              }
                              aria-pressed={row.pinned}
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await client.webs.pin({
                                    id: row.id,
                                    pinned: !row.pinned,
                                  });
                                  if (alive.current)
                                    setRefresh((value) => value + 1);
                                })
                              }
                            >
                              <Pin size={15} />
                            </Button>
                          </div>
                          <p>{row.summary || "Una web creada en Mycellios."}</p>
                          <div className="hw-card-footer">
                            <span>
                              <Eye size={13} /> {row.views} visitas
                            </span>
                            <span>
                              {row.published
                                ? `v${row.revision}`
                                : "Borrador privado"}
                            </span>
                          </div>
                          <div className="hw-card-controls">
                            {row.published && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => void clone(row.id)}
                              >
                                <Copy /> Clonar
                              </Button>
                            )}
                            {row.owned && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => void edit(row.id)}
                              >
                                <Code2 /> Editar
                              </Button>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="hw-empty">
                    <Globe2 size={36} strokeWidth={1.2} />
                    <h2>
                      {query
                        ? "No encontramos esa app"
                        : filter === "pinned"
                          ? "Tus apps favoritas, a mano"
                          : filter === "mine"
                            ? "Dale una dirección a tu próxima idea"
                            : "La primera app puede ser la tuya"}
                    </h2>
                    <p>
                      {filter === "pinned"
                        ? "Fija una app del directorio para encontrarla aquí."
                        : "Sube HTML, CSS, JavaScript e imágenes. Mycellios pone el espacio y la dirección."}
                    </p>
                    {!query && filter !== "pinned" && (
                      <div className="hw-actions">
                        <Button onClick={create}>Crear app</Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void antseed()}
                        >
                          Empezar con Antseed Radar
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
          )}
          <footer className="hw-directory-footer">
            <span>Apps de la comunidad · sin dominio propio</span>
            <a
              href={appPath("/api/published-webs/")}
              target="_blank"
              rel="noopener noreferrer"
            >
              Directorio público <ArrowUpRight size={13} />
            </a>
          </footer>
        </>
      )}
    </section>
  );
}
