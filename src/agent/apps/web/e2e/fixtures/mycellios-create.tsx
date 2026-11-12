import {createRoot} from "react-dom/client";
import {I18nProvider} from "@lingui/react";
import {setupI18n} from "@lingui/core";
import {MycelliosCreate} from "../../src/pages/marketplace/MycelliosCreate";
import "../../src/styles.css";
import {applyResolvedAppearance} from "../../src/lib/ui-appearance";
applyResolvedAppearance("light");
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={setupI18n({locale:"es",messages:{es:{}}})}><main className="min-h-screen bg-background px-5 text-foreground"><p className="pt-4 text-xs text-muted-foreground">Vista de prueba local · no realiza inferencia ni pagos</p><MycelliosCreate onBack={()=>{}}/></main></I18nProvider>);
