/** A public-data utility, not a claim of live routing availability or an Antseed affiliation. */
export type AntseedRadarOffer = {
  id: string;
  model: string;
  peerId: string;
  seller: string;
  provider: string;
  region: string;
  categories: string[];
  input: number | null;
  output: number | null;
  cached: number | null;
  billing: "tokens" | "units";
  units: Array<{ unit: string; price: number }>;
  free: boolean;
};
export type AntseedRadarSnapshot = {
  updatedAt: string | null;
  peerCount: number;
  modelCount: number;
  offers: AntseedRadarOffer[];
};

/** Self-contained so the exact tested function can be embedded as ordinary script, without eval. */
export function parseAntseedSnapshot(raw: unknown): AntseedRadarSnapshot {
  const record = (v: unknown): Record<string, unknown> | null =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const rate = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const root = record(raw);
  if (!root || !Array.isArray(root.peers) || root.peers.length > 5000)
    throw new Error("Formato de datos de Antseed no reconocido.");
  const stamp = root.updatedAt;
  const parsedStamp =
    typeof stamp === "string"
      ? new Date(stamp).getTime()
      : typeof stamp === "number" && Number.isFinite(stamp)
        ? stamp < 1e12
          ? stamp * 1000
          : stamp
        : NaN;
  const offers: AntseedRadarOffer[] = [];
  const seen = new Set<string>();
  const peers = new Set<string>();
  const models = new Set<string>();
  for (const value of root.peers) {
    const peer = record(value);
    if (!peer) continue;
    const peerId = text(peer.peerId, 200);
    if (!peerId || !Array.isArray(peer.providers)) continue;
    for (const value of peer.providers.slice(0, 256)) {
      const provider = record(value);
      if (!provider || !Array.isArray(provider.services)) continue;
      const providerName = text(provider.provider, 100) || "Sin identificar";
      const defaults = record(provider.defaultPricing) ?? {};
      const pricing = record(provider.servicePricing) ?? {};
      const categories = record(provider.serviceCategories) ?? {};
      const billingModels = record(provider.serviceUnitBillingModels) ?? {};
      for (const value of provider.services.slice(0, 5000)) {
        const model = text(value, 240);
        if (!model) continue;
        const id = JSON.stringify([peerId, providerName, model]);
        if (seen.has(id)) continue;
        seen.add(id);
        const override = record(Object.hasOwn(pricing, model) ? pricing[model] : undefined) ?? {};
        const price = { ...defaults, ...override };
        const declaredUnits = record(
          Object.hasOwn(billingModels, model) ? billingModels[model] : undefined,
        );
        const units: Array<{ unit: string; price: number }> = [];
        let completeUnits =
          !!declaredUnits &&
          Object.keys(declaredUnits).length > 0 &&
          Object.keys(declaredUnits).length <= 32;
        if (declaredUnits) {
          for (const value of Object.values(declaredUnits).slice(0, 32)) {
            const components = record(value)?.components;
            if (!Array.isArray(components) || !components.length) {
              completeUnits = false;
              continue;
            }
            if (components.length > 32) completeUnits = false;
            for (const value of components.slice(0, 32)) {
              const component = record(value);
              const unit = text(component?.unit, 100),
                price = rate(component?.priceUsd);
              if (unit && price !== null) units.push({ unit, price });
              else completeUnits = false;
            }
          }
        }
        // Unit-billed image/video services may intentionally announce zero token rates.
        // Presence of their billing model prevents a false FREE / zero-token estimate.
        const billing = declaredUnits ? "units" : "tokens";
        const input = billing === "tokens" ? rate(price.inputUsdPerMillion) : null;
        const output = billing === "tokens" ? rate(price.outputUsdPerMillion) : null;
        const cached = billing === "tokens" ? rate(price.cachedInputUsdPerMillion) : null;
        const tags = Object.hasOwn(categories, model) ? categories[model] : undefined;
        offers.push({
          id,
          model,
          peerId,
          provider: providerName,
          seller: text(peer.displayName, 160) || `${peerId.slice(0, 12)}…`,
          region: text(peer.region, 80),
          categories: Array.isArray(tags)
            ? [...new Set(tags.map((v) => text(v, 60)).filter(Boolean))].slice(0, 16)
            : [],
          input,
          output,
          cached,
          billing,
          units,
          free:
            billing === "tokens"
              ? input === 0 && output === 0
              : completeUnits && units.length > 0 && units.every((v) => v.price === 0),
        });
        peers.add(peerId);
        models.add(model);
        if (offers.length > 50000) throw new Error("El catálogo excede el límite de esta vista.");
      }
    }
  }
  return {
    updatedAt:
      Number.isFinite(parsedStamp) && Math.abs(parsedStamp) <= 8.64e15
        ? new Date(parsedStamp).toISOString()
        : null,
    peerCount: peers.size,
    modelCount: models.size,
    offers,
  };
}

/** No unit-billed, unpriced or non-finite offer is silently estimated as free. */
export function estimateAntseedCost(
  offer: Pick<AntseedRadarOffer, "billing" | "input" | "output">,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (
    offer.billing !== "tokens" ||
    offer.input === null ||
    offer.output === null ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0 ||
    inputTokens > 1e9 ||
    outputTokens > 1e9
  )
    return null;
  const estimate = (offer.input * inputTokens + offer.output * outputTokens) / 1e6;
  return Number.isFinite(estimate) ? estimate : null;
}

export const ANTSEED_RADAR_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="referrer" content="no-referrer">
<title>Antseed Radar · Compara modelos y costes</title>
<meta name="description" content="Explora las ofertas públicas de Antseed y estima el coste anunciado según tus tokens de entrada y salida. Sin conectar una cuenta.">
<style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#203d32;background:#f7f7f1;font-synthesis:none;--ink:#203d32;--muted:#526457;--line:#d5ddcf;--green:#28593f;--accent:#d5e99d}
*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button,select{cursor:pointer}button:disabled{cursor:default;opacity:.5}a{color:inherit;text-underline-offset:3px}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #56814a;outline-offset:3px}::selection{background:#d5e99d;color:#203d32}
.wrap{max-width:1220px;padding:28px 34px 48px;margin:auto}.top{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:25px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:11px;font-size:18px;font-weight:700;letter-spacing:-.035em}.mark{width:29px;height:29px;border:7px solid #28593f;border-radius:50%;position:relative}.mark:after{content:"";position:absolute;inset:3px;background:#28593f;border-radius:50%}.privacy{font-size:12px;color:var(--muted)}.intro{display:flex;justify-content:space-between;align-items:end;gap:28px;padding:31px 0 26px}h1{font-size:clamp(27px,4vw,40px);line-height:1.13;letter-spacing:-.035em;max-width:620px;margin:0 0 12px;font-weight:600}.intro p{margin:0;max-width:650px;font-size:14px;color:var(--muted);line-height:1.6}.refresh{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px 14px;color:var(--ink);background:#fff;white-space:nowrap;font-size:13px}.refresh:hover{background:#edf2e6}.refresh svg{width:15px;height:15px}.summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;font-size:13px;padding-bottom:20px;color:var(--muted)}.summary strong{font-variant-numeric:tabular-nums;color:var(--ink);font-size:16px;margin-right:5px}.summary .updated{margin-left:auto;font-size:12px}.state{margin:0 0 16px;padding:12px 14px;background:#edf2e6;border-radius:8px;font-size:13px;line-height:1.5}.state[data-tone=error]{background:#fff0dd;color:#774719}.state[hidden]{display:none}
.workspace{border:1px solid var(--line);border-radius:14px;background:#fff;overflow:hidden}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:17px 18px;border-bottom:1px solid var(--line)}.search{position:relative;flex:1 1 250px}.search svg{position:absolute;left:12px;top:12px;width:16px;height:16px;color:var(--muted)}input[type=search],select{border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink);min-height:40px;padding:8px 11px;font-size:13px}input[type=search]{width:100%;padding-left:36px}input::placeholder{color:var(--muted);opacity:1}.free{display:inline-flex;align-items:center;gap:7px;font-size:13px;min-height:40px;white-space:nowrap}.free input{accent-color:var(--green);width:15px;height:15px}.estimate{display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px;padding:14px 18px;background:#f3f6ed;border-bottom:1px solid var(--line);font-size:12px}.estimate strong{font-size:13px;font-weight:600}.estimate label{display:flex;align-items:center;gap:8px}.estimate input{width:100px;padding:7px 8px;border-radius:6px;border:1px solid #bac8b1;background:#fff;color:var(--ink);font-size:13px;font-variant-numeric:tabular-nums}.estimate small{color:var(--muted);margin-left:auto}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}th{font-weight:500;background:#fafbf7;color:var(--muted);font-size:11px;padding:13px 18px;border-bottom:1px solid var(--line);white-space:nowrap}td{padding:14px 18px;border-bottom:1px solid #e7ecdf;vertical-align:middle}.model{min-width:245px}.model button{display:block;max-width:360px;padding:0;border:0;background:none;color:var(--ink);font-weight:600;text-align:left;overflow-wrap:anywhere;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px}.model button:hover{text-decoration-color:currentColor}.seller{display:block;font-size:11px;color:var(--muted);margin-top:5px}.tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.tag{font-size:10px;color:#45623d;border:1px solid #dbe5d3;border-radius:4px;padding:2px 5px;line-height:1.3}.number{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}.cost{font-weight:600}.unit-note{display:block;font-size:10px;color:var(--muted);font-weight:400;margin-top:4px}.zero{color:#2a653c}.empty{padding:45px 20px;text-align:center;line-height:1.5;color:var(--muted);font-size:14px}.pagination{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:14px 18px;font-size:12px;color:var(--muted)}.pagination div{display:flex;gap:7px}.pagination button{border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);padding:7px 10px;font-size:12px}.pagination button:not(:disabled):hover{background:#edf2e6}.footnote{font-size:12px;color:var(--muted);line-height:1.65;margin:20px 1px 0}.footnote p{margin:7px 0}.sources{display:flex;flex-wrap:wrap;gap:10px 20px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
dialog{border:1px solid var(--line);border-radius:14px;padding:26px;width:min(530px,calc(100vw - 28px));max-height:85dvh;overflow:auto;background:#fff;color:var(--ink)}dialog::backdrop{background:#172b2255}dialog h2{font-size:22px;line-height:1.3;letter-spacing:-.025em;margin:0 35px 18px 0;overflow-wrap:anywhere}.close{position:absolute;right:15px;top:14px;border:0;background:#edf2e6;color:var(--ink);width:30px;height:30px;border-radius:7px;font-size:21px;line-height:1}dl{display:grid;grid-template-columns:auto 1fr;gap:12px 22px;font-size:13px;line-height:1.5}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.detail-note{border-top:1px solid var(--line);padding-top:15px;font-size:12px;line-height:1.6;color:var(--muted)}
@media(max-width:760px){.wrap{padding:19px 16px 30px}.top{padding-bottom:19px}.privacy{max-width:140px;text-align:right;font-size:11px}.intro{display:block;padding:24px 0 20px}.intro .refresh{margin-top:17px}.summary{gap:9px 17px}.summary .updated{margin-left:0;width:100%}.controls{padding:13px;gap:8px}.search{flex-basis:100%}.controls select{flex:1;min-width:0}.estimate{padding:13px;gap:11px 16px}.estimate strong{width:100%}.estimate input{width:85px}.estimate small{width:100%;margin:0}td,th{padding:12px 13px}.model{min-width:210px}.number{min-width:100px}.pagination{padding:12px 13px}.footnote{font-size:11px}dialog{padding:22px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:10px}}
@media(prefers-reduced-motion:no-preference){button,a{transition:background-color 140ms ease,color 140ms ease}}
</style></head><body><main class="wrap">
<header class="top"><div class="brand"><span class="mark" aria-hidden="true"></span>Antseed Radar</div><span class="privacy">Datos públicos.<br>Sin conectar una cuenta.</span></header>
<section class="intro" aria-labelledby="title"><div><h1 id="title">Compara el coste anunciado de una respuesta.</h1><p>Explora modelos y proveedores de Antseed. Ajusta tus tokens para comparar ofertas, sin ejecutar consultas ni gastar saldo.</p></div><button class="refresh" id="refresh" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 11-1l3 6M4 12l3 6a7 7 0 0 0 11-1"/></svg>Actualizar datos</button></section>
<div class="summary" aria-label="Resumen del catálogo"><span><strong id="peers">—</strong>proveedores anunciados</span><span><strong id="models">—</strong>modelos distintos</span><span><strong id="offers">—</strong>ofertas</span><span class="updated" id="updated">Esperando datos públicos…</span></div>
<p class="state" id="state" role="status">Cargando el catálogo público de Antseed…</p>
<section class="workspace" aria-label="Explorador de ofertas"><div class="controls"><label class="search"><span class="sr-only">Buscar modelo o proveedor</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="search" type="search" placeholder="Buscar modelo o proveedor…" autocomplete="off"></label><label><span class="sr-only">Categoría</span><select id="category"><option value="">Todas las categorías</option></select></label><label><span class="sr-only">Ordenar ofertas</span><select id="sort"><option value="estimate">Menor coste estimado</option><option value="input">Menor precio de entrada</option><option value="output">Menor precio de salida</option><option value="name">Nombre del modelo</option></select></label><label class="free"><input id="free" type="checkbox">Solo gratis</label></div>
<div class="estimate"><strong>Estima una solicitud</strong><label>Entrada <input id="input-tokens" type="number" inputmode="numeric" min="0" max="1000000000" step="100" value="1000" aria-label="Tokens de entrada"></label><label>Salida <input id="output-tokens" type="number" inputmode="numeric" min="0" max="1000000000" step="100" value="500" aria-label="Tokens de salida"></label><small>Sin caché · Solo servicios facturados por tokens</small></div>
<div class="table-scroll"><table><caption class="sr-only">Ofertas anunciadas en el último snapshot público de Antseed</caption><thead><tr><th scope="col">Modelo / proveedor</th><th scope="col" class="number">Entrada · USD / M</th><th scope="col" class="number">Salida · USD / M</th><th scope="col" class="number">Estimación · USD</th></tr></thead><tbody id="rows"></tbody></table></div><p id="empty" class="empty" hidden>No hay ofertas que coincidan con estos filtros.</p><div class="pagination"><span id="range" role="status">Sin datos todavía</span><div><button id="previous" type="button" disabled>Anterior</button><button id="next" type="button" disabled>Siguiente</button></div></div></section>
<footer class="footnote"><p>Precios anunciados por los proveedores en un snapshot del indexador, no una garantía de disponibilidad, calidad o precio de compra. Una oferta con precio desconocido no se considera gratis. Los servicios por imagen, vídeo u otras unidades no se comparan como si fueran tokens.</p><p>La estimación multiplica tus tokens por las tarifas anunciadas; no incluye caché, tarifas por unidad ni otros posibles costes. Confirma la oferta en tu cliente de Antseed antes de usarla.</p><div class="sources"><a href="https://network.antseed.com/stats" target="_blank" rel="noopener noreferrer">Snapshot público de Antseed</a><a href="https://antseed.com/docs/api/routing/" target="_blank" rel="noopener noreferrer">Cómo se publican estos datos</a></div><p>Herramienta comunitaria independiente. No es un servicio oficial de Antseed. No solicita claves, pagos ni acceso a tu cuenta.</p></footer>
</main><dialog id="detail" aria-labelledby="detail-title"><button type="button" class="close" id="close-detail" aria-label="Cerrar oferta">×</button><h2 id="detail-title"></h2><dl id="detail-fields"></dl><p class="detail-note">Información anunciada por este proveedor. No se ha enviado ninguna solicitud al modelo ni se ha verificado aquí su disponibilidad.</p></dialog>
<script>
"use strict";
// esbuild/tsx may preserve names in serialized functions; no external runtime is required.
const __name = fn => fn;
const parseSnapshot = (${parseAntseedSnapshot.toString()});
const estimateCost = (${estimateAntseedCost.toString()});
const byId = id => document.getElementById(id);
const usd = value => value === null ? "—" : new Intl.NumberFormat("en-US", {maximumFractionDigits:8}).format(value);
const count = value => new Intl.NumberFormat("es").format(value);
const labels = {chat:"Texto",coding:"Código",reasoning:"Razonamiento",math:"Matemáticas",vision:"Visión",image:"Imagen",video:"Vídeo",audio:"Audio",fast:"Rápido",tools:"Herramientas",agents:"Agentes",web:"Web"};
let snapshot = null, page = 0, loading = false, lastAttempt = 0;
const pageSize = 40;
function tokenValue(id) { const value=byId(id).value; return value === "" ? NaN : Number(value); }
function node(tag, text, className) {const element=document.createElement(tag); if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
function showState(text, tone) {const state=byId("state");state.textContent=text;state.dataset.tone=tone||"normal";state.hidden=!text;}
function describe(offer) {
 const dialog=byId("detail");byId("detail-title").textContent=offer.model;
 const fields=byId("detail-fields");fields.replaceChildren();
 const entries=[["Proveedor",offer.seller],["Plugin",offer.provider],["Peer ID",offer.peerId],["Región",offer.region||"No anunciada"],["Facturación",offer.billing==="units"?"Por unidad":"Por millón de tokens"],["Entrada",offer.input===null?"No aplicable o no anunciada":usd(offer.input)+" USD / M"],["Salida",offer.output===null?"No aplicable o no anunciada":usd(offer.output)+" USD / M"],["Entrada en caché",offer.cached===null?"No anunciada":usd(offer.cached)+" USD / M"]];
 if(offer.units.length)entries.push(["Tarifas por unidad",offer.units.map(v=>usd(v.price)+" USD / "+v.unit).join("; ")]);
 entries.forEach(([label,value])=>fields.append(node("dt",label),node("dd",value)));
 dialog.showModal();
}
function render() {
 if(!snapshot)return;
 const query=byId("search").value.trim().toLocaleLowerCase(),category=byId("category").value,free=byId("free").checked;
 const input=tokenValue("input-tokens"),output=tokenValue("output-tokens");
 const rows=snapshot.offers.filter(v=>(!query||(v.model+" "+v.seller+" "+v.provider).toLocaleLowerCase().includes(query))&&(!category||v.categories.includes(category))&&(!free||v.free)).map(v=>({offer:v,estimate:estimateCost(v,input,output)}));
 const sort=byId("sort").value;
 rows.sort((a,b)=>{if(sort!=="name"){const av=sort==="input"?a.offer.input:sort==="output"?a.offer.output:a.estimate,bv=sort==="input"?b.offer.input:sort==="output"?b.offer.output:b.estimate;if(av===null&&bv!==null)return 1;if(av!==null&&bv===null)return -1;if(av!==null&&bv!==null&&av!==bv)return av-bv;}return a.offer.model.localeCompare(b.offer.model)||a.offer.seller.localeCompare(b.offer.seller);});
 page=Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1));
 const body=byId("rows");body.replaceChildren();
 rows.slice(page*pageSize,(page+1)*pageSize).forEach(({offer,estimate})=>{
  const tr=node("tr"),model=node("td",undefined,"model"),button=node("button",offer.model);button.type="button";button.addEventListener("click",()=>describe(offer));
  model.append(button,node("span",offer.seller+" · "+offer.provider,"seller"));
  const tags=node("div",undefined,"tags");offer.categories.slice(0,3).forEach(v=>tags.append(node("span",labels[v]||v,"tag")));model.append(tags);tr.append(model);
  [offer.input,offer.output].forEach(value=>tr.append(node("td",value===0?"Gratis":usd(value),"number"+(value===0?" zero":""))));
  const cost=node("td",estimate===null?"—":estimate===0?"Gratis":usd(estimate),"number cost"+(estimate===0?" zero":""));
  if(offer.billing==="units")cost.append(node("span",offer.free?"Por unidad · gratis":"Por unidad","unit-note"));
  else if(estimate===null)cost.append(node("span",Number.isFinite(input)&&Number.isFinite(output)?"Precio no informado":"Revisa los tokens","unit-note"));
  tr.append(cost);body.append(tr);
 });
 byId("empty").hidden=rows.length!==0;
 byId("range").textContent=rows.length?count(page*pageSize+1)+"–"+count(Math.min((page+1)*pageSize,rows.length))+" de "+count(rows.length)+" ofertas":"0 ofertas";
 byId("previous").disabled=page===0;byId("next").disabled=(page+1)*pageSize>=rows.length;
}
function updateSummary() {
 byId("peers").textContent=count(snapshot.peerCount);byId("models").textContent=count(snapshot.modelCount);byId("offers").textContent=count(snapshot.offers.length);
 byId("updated").textContent=snapshot.updatedAt?"Snapshot: "+new Intl.DateTimeFormat("es",{dateStyle:"short",timeStyle:"short"}).format(new Date(snapshot.updatedAt)):"Actualización no informada";
 const selected=byId("category").value,select=byId("category");select.replaceChildren();const all=node("option","Todas las categorías");all.value="";select.append(all);
 [...new Set(snapshot.offers.flatMap(v=>v.categories))].sort().forEach(value=>{const option=node("option",labels[value]||value);option.value=value;select.append(option);});select.value=selected;
}
async function refresh() {
 if(loading||Date.now()-lastAttempt<5000)return;loading=true;lastAttempt=Date.now();byId("refresh").disabled=true;
 if(!snapshot)showState("Cargando el catálogo público de Antseed…");
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try {
  const response=await fetch("https://network.antseed.com/stats",{credentials:"omit",referrerPolicy:"no-referrer",signal:controller.signal});
  if(!response.ok)throw new Error("HTTP "+response.status);
  const content=await response.text();if(content.length>16*1024*1024)throw new Error("Snapshot demasiado grande");
  const next=parseSnapshot(JSON.parse(content));if(!next.offers.length)throw new Error("No se han encontrado ofertas");
  snapshot=next;updateSummary();render();
  const age=snapshot.updatedAt?Date.now()-new Date(snapshot.updatedAt).getTime():Infinity;
  showState(age>15*60*1000?"El snapshot tiene más de 15 minutos o no informa su fecha. Los precios pueden estar desactualizados.":"",age>15*60*1000?"error":"normal");
 }catch(error){showState(snapshot?"No se pudo actualizar Antseed. Se conservan los datos del último snapshot cargado; revisa su fecha antes de comparar.":"No se pudo cargar el catálogo público. Comprueba tu conexión y pulsa Actualizar datos para volver a intentarlo.","error");}
 finally{clearTimeout(timeout);loading=false;byId("refresh").disabled=false;}
}
["search","category","sort","free","input-tokens","output-tokens"].forEach(id=>byId(id).addEventListener(id==="search"||id.endsWith("tokens")?"input":"change",()=>{page=0;render();}));
byId("refresh").addEventListener("click",refresh);byId("previous").addEventListener("click",()=>{page=Math.max(0,page-1);render();});byId("next").addEventListener("click",()=>{page++;render();});byId("close-detail").addEventListener("click",()=>byId("detail").close());
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&Date.now()-lastAttempt>120000)void refresh();});
setInterval(()=>{if(document.visibilityState==="visible")void refresh();},120000);
void refresh();
</script></body></html>`;
