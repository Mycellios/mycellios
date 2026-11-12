import { Button, Checkbox, Input } from "@rakazo/ui-web";
import { ArrowRight, Check, Pause, Play,ChevronDown } from "lucide-react";
import type { Cut } from "./analysis";
const seconds = (n: number) => `${n.toFixed(2).replace(".", ",")} s`;
const clock = (n: number) =>
  `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, "0")}`;
type Props = {
  cuts: Cut[];
  total: number;
  busy: string;
  active: string | null;
  audition: string;
  error: string;
  onClear: () => void;
  onSelect: (cut: Cut) => void;
  onChange: (id: string, patch: Partial<Cut>) => void;
  onPlay: (cut: Cut, edited: boolean) => Promise<void>;
  onStop: () => void;
};
export function CutReview({
  cuts,
  total,
  busy,
  active,
  audition,
  error,
  onClear,
  onSelect,
  onChange,
  onPlay,
  onStop,
}: Props) {
  const currentCut = cuts.find((c) => c.id === active);
  return (
    <aside className="cd-review" aria-label="Revisar cortes">
      <header>
        <span>{cuts.filter(cut => cut.enabled).length} seleccionados</span>
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={onClear}>
          Desmarcar todos
        </Button>
      </header>
      {!cuts.length && (
        <div className="cd-no-cuts">
          <Check size={22} />
          <h3>No encontramos cortes claros.</h3>
          <p>
            El original se mantiene. Puedes ajustar la detección o probar otro
            archivo.
          </p>
        </div>
      )}
      <p className="cd-review-note">
        Las posibles vocales se conservan hasta que las marques.
      </p>
      <div className="cd-cut-list">
        {cuts.map((cut, index) => (
          <article
            key={cut.id}
            className={`cd-cut ${active === cut.id ? "is-active" : ""}`}
          >
            <div className="cd-cut-title">
              <Checkbox
                aria-label={`Aplicar corte ${index + 1}`}
                checked={cut.enabled}
                disabled={!!busy}
                onCheckedChange={(enabled) => onChange(cut.id, { enabled })}
              />
              <Button
                variant="ghost"
                className="cd-cut-open"
                onClick={() => onSelect(cut)}
                aria-expanded={active===cut.id}
                disabled={!!busy}
              >
                <span className="cd-cut-label">
                <span>
                  {cut.kind === "silence"
                    ? "Pausa"
                    : "Posible vocal alargada"}
                </span>
                <small>
                  {clock(cut.start)} <ArrowRight size={11} /> {clock(cut.end)}
                </small>
                </span>
                <ChevronDown size={13} aria-hidden="true" />
              </Button>
              <strong>−{seconds(cut.end - cut.start)}</strong>
            </div>
            {active===cut.id&&cut.kind === "vowel" && (
              <p className="cd-cut-warning">
                Puede ser intencionada. Conservamos el arranque y el final del
                sonido.
              </p>
            )}
            {active===cut.id&&<div className="cd-cut-listen">
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                aria-label={`Escuchar antes del corte ${index + 1}`}
                aria-pressed={audition === `${cut.id}:before`}
                onClick={() => void onPlay(cut, false)}
              >
                <Play size={12} /> Original
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy || !!error}
                aria-label={`Escuchar después del corte ${index + 1}`}
                aria-pressed={audition === `${cut.id}:after`}
                onClick={() => void onPlay(cut, true)}
              >
                <Play size={12} /> Con el corte
              </Button>
              {audition.startsWith(`${cut.id}:`) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Detener escucha"
                  onClick={onStop}
                >
                  <Pause size={12} />
                </Button>
              )}
            </div>}
            {active === cut.id && (
              <details className="cd-cut-adjust"><summary>Ajustar este corte <ChevronDown size={13} aria-hidden="true"/></summary><div className="cd-cut-bounds">
                <label>
                  Inicio (s)
                  <Input
                    aria-label={`Inicio del corte ${index + 1} en segundos`}
                    type="number"
                    min={0}
                    max={total}
                    step={0.001}
                    value={Number(cut.start.toFixed(3))}
                    disabled={!!busy}
                    onChange={(event) =>
                      onChange(cut.id, {
                        start: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Final (s)
                  <Input
                    aria-label={`Final del corte ${index + 1} en segundos`}
                    type="number"
                    min={0}
                    max={total}
                    step={0.001}
                    value={Number(cut.end.toFixed(3))}
                    disabled={!!busy}
                    onChange={(event) =>
                      onChange(cut.id, {
                        end: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div></details>
            )}
          </article>
        ))}
      </div>
      {currentCut && (
        <span className="cd-sr-only" role="status">
          Corte seleccionado: {clock(currentCut.start)} a{" "}
          {clock(currentCut.end)}
        </span>
      )}
    </aside>
  );
}
