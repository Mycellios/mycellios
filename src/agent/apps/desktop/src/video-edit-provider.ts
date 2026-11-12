import type { VideoEditQuote } from "../../../packages/contracts/src/video-edit.js";

export type EditSource = { duration: number; width: number; height: number };
export type EditOffer = Pick<VideoEditQuote, "model" | "seller" | "protocol" | "resolution" | "creditsMicros">;
export interface VideoEditProvider {
  offers(source: EditSource): Promise<EditOffer[]>;
  create(offer: EditOffer, prompt: string, video: Uint8Array, source: EditSource): Promise<string>;
  retrieve(offer: EditOffer, id: string): Promise<{ status: "running" | "failed" } | { status: "ready"; bytes: Uint8Array }>;
}

/** Antseed's documented buyer protocol. No guessed price, model fallback or repeated create. */
export class AntseedVideoEditProvider implements VideoEditProvider {
  constructor(private fetcher: typeof fetch = fetch, private base = "http://127.0.0.1:8377") {
    const url = new URL(base);
    if (url.origin !== "http://127.0.0.1:8377" || url.pathname !== "/" || url.search || url.hash)
      throw new Error("El buyer de vídeo debe estar en 127.0.0.1:8377.");
  }
  private async request(route: string, body?: unknown, timeout = 30_000) {
    const response = await this.fetcher(`${this.base}${route}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(timeout),
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Antseed no pudo completar la petición. El trabajo no se reenviará automáticamente."); }
    return response;
  }
  async offers(source: EditSource): Promise<EditOffer[]> {
    const response = await this.request("/v1/models?type=videos", undefined, 5000);
    const text = await bounded(response, 2_000_000);
    const catalog = JSON.parse(Buffer.from(text).toString("utf8"));
    const offers: EditOffer[] = [];
    for (const model of Array.isArray(catalog.data) ? catalog.data : []) {
      if (typeof model.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(model.id)) continue;
      for (const peer of Array.isArray(model.peers) ? model.peers : []) {
        const video = peer.capabilities?.video;
        if (!video?.inputs?.includes("video") || !["fal-video", "venice-video"].includes(peer.protocol) || typeof peer.peerId !== "string" || !/^[A-Za-z0-9:_-]{1,256}$/.test(peer.peerId)) continue;
        // This first flow edits by text; character/image/audio requirements need their own reviewed UI.
        if ((video.requiredInputs ?? []).some((item: string) => !["video", "text"].includes(item))) continue;
        if (Array.isArray(video.durationsSeconds) && !video.durationsSeconds.includes(Math.floor(source.duration))) continue;
        if (Number.isFinite(video.maxDurationSeconds) && source.duration > video.maxDurationSeconds) continue;
        for (const resolution of Array.isArray(video.resolutions) ? video.resolutions : []) {
          if (typeof resolution !== "string" || !/^[0-9]{3,4}[pP]$/.test(resolution)) continue;
          const components = peer.unitBillingModels?.[peer.protocol]?.components;
          if (!Array.isArray(components)) continue;
          const applicable = components.filter((c: any) => (!c.match?.resolution || c.match.resolution === resolution) && (!c.match?.model || c.match.model === peer.serviceId));
          if (!applicable.length || applicable.some((c: any) => !["video_seconds", "video_generations"].includes(c.unit) || !Number.isFinite(c.priceUsd) || c.priceUsd < 0)) continue;
          const micros = Math.ceil(applicable.reduce((sum: number, c: any) => sum + c.priceUsd * (c.unit === "video_seconds" ? Math.floor(source.duration) : 1), 0) * 1_000_000);
          // Above $1, failed Antseed jobs may retain a channel opening fee; not admitted by this first flow.
          if (!Number.isSafeInteger(micros) || micros <= 0 || micros > 1_000_000) continue;
          offers.push({ model: model.id, seller: peer.peerId, protocol: peer.protocol, resolution, creditsMicros: micros });
        }
      }
    }
    return offers.sort((a, b) => a.creditsMicros - b.creditsMicros);
  }
  async create(offer: EditOffer, prompt: string, video: Uint8Array, source: EditSource) {
    const seconds = Math.floor(source.duration);
    if (!seconds) throw new Error("Falta la duración verificada del vídeo.");
    const route = offer.protocol === "fal-video" ? "/fal/v1/video/queue" : "/api/v1/video/queue";
    const response = await this.request(route, { model: `${offer.seller}@${offer.model}`, prompt,
      video_url: `data:video/mp4;base64,${Buffer.from(video).toString("base64")}`,
      duration: offer.protocol === "fal-video" ? String(seconds) : `${seconds}s`, resolution: offer.resolution }, 120_000);
    const result = JSON.parse(Buffer.from(await bounded(response, 100_000)).toString("utf8"));
    const id=offer.protocol==="fal-video"?result.request_id:result.queue_id;
    if (typeof id !== "string" || !id || id.length > 512) throw new Error("Antseed no devolvió un identificador recuperable.");
    return id;
  }
  async retrieve(offer: EditOffer, id: string) {
    const route = offer.protocol === "fal-video" ? "/fal/v1/video/retrieve" : "/api/v1/video/retrieve";
    const response = await this.request(route, { model: `${offer.seller}@${offer.model}`, [offer.protocol==="fal-video"?"request_id":"queue_id"]: id }, 120_000);
    if (response.headers.get("content-type")?.split(";")[0] === "video/mp4") return { status: "ready" as const, bytes: await bounded(response, 64 * 1024 * 1024) };
    const result = JSON.parse(Buffer.from(await bounded(response, 100_000)).toString("utf8"));
    return { status: result.status === "failed" || result.error ? "failed" as const : "running" as const };
  }
}

export async function bounded(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("El archivo supera el límite permitido."); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Respuesta vacía.");
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length;
      if (length > limit) throw new Error("El archivo supera el límite permitido."); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, length);
}
