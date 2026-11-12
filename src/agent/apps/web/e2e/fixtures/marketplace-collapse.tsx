import {useState} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {I18nProvider} from "@lingui/react";
import {MarketplaceWorkspace} from "../../src/pages/marketplace/MarketplaceWorkspace";
import type {MarketplaceTab} from "../../src/pages/marketplace/catalog";
import {bootstrapI18n,i18n} from "../../src/lib/i18n";
import {applyResolvedAppearance} from "../../src/lib/ui-appearance";
import "../../src/styles.css";
function Fixture(){const [tab,setTab]=useState<MarketplaceTab>("mycellios-apps");return <div style={{height:"100dvh",display:"flex"}}><MarketplaceWorkspace tab={tab} onTab={setTab} scope='["fixture-owner","fixture-space"]' spaceId="fixture-space" bots={[]} onExit={()=>{}} onMcp={()=>{}} onCreated={()=>{}} onOpenBot={()=>{}} onBotsChanged={async()=>{}} onCreateBot={()=>{}}/></div>;}
applyResolvedAppearance("light");void bootstrapI18n("es").then(()=>createRoot(document.getElementById("root")!).render(<MemoryRouter><I18nProvider i18n={i18n}><Fixture/></I18nProvider></MemoryRouter>));
