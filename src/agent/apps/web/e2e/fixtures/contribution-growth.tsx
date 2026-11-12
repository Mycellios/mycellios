import { createRoot } from "react-dom/client";
import { Play } from "lucide-react";
import { startContributionGrowth } from "../../src/lib/contribution-growth";
import "../../src/styles.css";
import "../../src/components/contribution.css";
// Animation-only fixture. No compute, account or payment API is called.
createRoot(document.getElementById("root")!).render(<main className="relative min-h-dvh bg-background"><p className="p-6 text-xs text-muted-foreground">Vista previa de animación · Sin iniciar inferencia</p><aside className="absolute bottom-8 left-4 w-72 border-t border-border bg-sidebar p-3"><button type="button" className="rk-contribution-button gap-2 px-2 text-start" onClick={e=>startContributionGrowth(e.currentTarget)}><span className="min-w-0 flex-1"><span className="text-sm">Generar IA</span><span className="text-[11px] text-muted-foreground">Aporta potencia a la red</span></span><span className="rk-contribution-play"><Play className="size-5 ms-0.5"/></span></button></aside></main>);
