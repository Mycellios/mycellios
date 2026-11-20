/**
 * Preview-only helper (never in published revisions): answers the editor's
 * `mycellios.locate` with an element's viewport rectangle, so the owner's live cursors
 * can point at the part a Mico is editing. It answers only its parent window and sends
 * nothing else; the page keeps its opaque sandbox.
 */
export const PREVIEW_LOCATOR_SCRIPT = `<script data-mycellios-preview-locator>(()=>{addEventListener("message",(e)=>{if(e.source!==parent)return;const d=e.data;if(!d||d.type!=="mycellios.locate"||typeof d.id!=="string"||d.id.length>64||typeof d.selector!=="string"||d.selector.length>512)return;let rect=null;try{const el=document.querySelector(d.selector);if(el){const b=el.getBoundingClientRect();rect={x:b.left,y:b.top,width:b.width,height:b.height};}}catch{}parent.postMessage({type:"mycellios.located",id:d.id,rect},"*");});})();</script>`;

export function withPreviewLocator(html: Uint8Array): Uint8Array<ArrayBuffer> {
  const source = Buffer.from(html).toString("utf8");
  const close = source.toLowerCase().lastIndexOf("</body>");
  const result =
    close < 0
      ? source + PREVIEW_LOCATOR_SCRIPT
      : source.slice(0, close) + PREVIEW_LOCATOR_SCRIPT + source.slice(close);
  return new TextEncoder().encode(result);
}
