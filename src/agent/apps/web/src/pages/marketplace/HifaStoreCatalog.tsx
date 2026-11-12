import { Button, Input } from "@rakazo/ui-web";
import { ArrowUpRight, Globe, Film, Monitor, Search, Waves } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { matches } from "./catalog";
import "./hifa-store.css";

const Cadencia = lazy(() => import("../cadencia/Cadencia"));

/** First-party browser tools are independent of the native Video Studio capability. */
export function HifaStoreCatalog({
  scope,
  onOpenStudio,
}: {
  scope: string;
  onOpenStudio?: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  function openCadencia(open: boolean) {
    const next = new URLSearchParams(params);
    if (open) next.set("app", "cadencia");
    else next.delete("app");
    setParams(next);
  }
  if (params.get("app") === "cadencia")
    return (
      <Suspense fallback={<p role="status">Abriendo Cadencia…</p>}>
        <Cadencia scope={scope} onBack={() => openCadencia(false)} />
      </Suspense>
    );
  const cadencia = matches(
    query,
    "Cadencia",
    "Recorta silencios y revisa vocales alargadas",
    "vídeo audio",
  );
  const studio =
    !!onOpenStudio &&
    matches(query, "Estudio de vídeos", "Crea vídeos verticales con narración", "vídeo audio");
  return (
    <section className="hf-store">
      <div className="rk-market-heading">
        <div>
          <h1>Hifa Store</h1>
          <p>Herramientas para crear con tus Micos.</p>
        </div>
      </div>
      <div className="rk-market-search">
        <div className="rk-market-search-field">
          <Search size={16} aria-hidden="true" />
          <Input
            type="search"
            aria-label="Buscar apps"
            placeholder="Buscar apps…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="hf-grid">
        {cadencia ? (
          <article className="hf-card">
            <Button
              variant="ghost"
              className="hf-cover"
              aria-label="Abrir Cadencia"
              onClick={() => openCadencia(true)}
            >
              <Waves size={46} strokeWidth={1.8} aria-hidden="true" />
              <span>Cadencia</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </Button>
            <div className="hf-body">
              <h2>Cadencia</h2>
              <p>Recorta silencios y revisa vocales alargadas. Escucha el antes y después.</p>
              <div className="hf-footer">
                <span>
                  <Globe size={13} aria-hidden="true" />
                  Navegador
                </span>
                <Button variant="ghost" size="sm" onClick={() => openCadencia(true)}>
                  Abrir
                </Button>
              </div>
            </div>
          </article>
        ) : null}
        {studio ? (
          <article className="hf-card">
            <Button
              variant="ghost"
              className="hf-cover"
              aria-label="Abrir Estudio de vídeos"
              onClick={onOpenStudio}
            >
              <Film size={38} aria-hidden="true" />
              <span>Estudio de vídeos</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </Button>
            <div className="hf-body">
              <h2>Estudio de vídeos</h2>
              <p>Crea vídeos verticales con narración.</p>
              <div className="hf-footer">
                <span>
                  <Monitor size={13} aria-hidden="true" />
                  Escritorio
                </span>
                <Button variant="ghost" size="sm" onClick={onOpenStudio}>
                  Abrir
                </Button>
              </div>
            </div>
          </article>
        ) : null}
      </div>
      {!cadencia && !studio ? <p role="status">No se encontraron apps.</p> : null}
    </section>
  );
}
