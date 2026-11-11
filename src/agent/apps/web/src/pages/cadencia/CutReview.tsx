import { Button, Checkbox, Input } from "@rakazo/ui-web";
import { ArrowRight, Check, Pause, Play } from "lucide-react";
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
        <div>
          <h2>Revisa los cortes</h2>
          <span>{cuts.length} propuestas</span>
        </div>
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
        Las posibles vocales se quedan sin marcar. Escúchalas antes de decidir.
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
                onClick={() => onSelect(cut)}
                disabled={!!busy}
              >
                <span>
                  {cut.kind === "silence"
                    ? "Silencio"
                    : "Posible vocal alargada"}
                </span>
                <small>
                  {clock(cut.start)} <ArrowRight size={11} /> {clock(cut.end)}
                </small>
              </Button>
              <strong>−{seconds(cut.end - cut.start)}</strong>
            </div>
            {cut.kind === "vowel" && (
              <p className="cd-cut-warning">
                Puede ser intencionada. Conservamos el arranque y el final del
                sonido.
              </p>
            )}
            <div className="cd-cut-listen">
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                aria-label={`Escuchar antes del corte ${index + 1}`}
                aria-pressed={audition === `${cut.id}:before`}
                onClick={() => void onPlay(cut, false)}
              >
                <Play size={12} /> Antes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy || !!error}
                aria-label={`Escuchar después del corte ${index + 1}`}
                aria-pressed={audition === `${cut.id}:after`}
                onClick={() => void onPlay(cut, true)}
              >
                <Play size={12} /> Después
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
            </div>
            {active === cut.id && (
              <div className="cd-cut-bounds">
                <label>
                  Desde
                  <Input
                    aria-label={`Inicio del corte ${index + 1} en milisegundos`}
                    type="number"
                    min={0}
                    max={Math.round(total * 1000)}
                    step={1}
                    value={Math.round(cut.start * 1000)}
                    disabled={!!busy}
                    onChange={(event) =>
                      onChange(cut.id, {
                        start: Number(event.target.value) / 1000,
                      })
                    }
                  />
                </label>
                <label>
                  Hasta
                  <Input
                    aria-label={`Final del corte ${index + 1} en milisegundos`}
                    type="number"
                    min={0}
                    max={Math.round(total * 1000)}
                    step={1}
                    value={Math.round(cut.end * 1000)}
                    disabled={!!busy}
                    onChange={(event) =>
                      onChange(cut.id, {
                        end: Number(event.target.value) / 1000,
                      })
                    }
                  />
                </label>
                <small>ms</small>
              </div>
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
