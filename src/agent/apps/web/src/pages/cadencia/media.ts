import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import {
  ANALYSIS_RATE,
  MAX_DURATION,
  MAX_FILE_BYTES,
  keptSegments,
  sourceTime,
  type Cut,
} from "./analysis";

class CadenciaMediaError extends Error {}
export type MediaInfo = {
  duration: number;
  origin: number;
  sampleRate: number;
  channels: number;
  width: number;
  height: number;
  video: boolean;
};
export type Rendered = {
  blob: Blob;
  extension: string;
  duration: number;
  format: string;
};
export function checkAbort(signal: AbortSignal) {
  signal.throwIfAborted();
}
export const stopError = () =>
  new DOMException("Operación cancelada.", "AbortError");

async function inspect(input: Input): Promise<MediaInfo> {
  const audio = await input.getPrimaryAudioTrack(),
    video = await input.getPrimaryVideoTrack();
  if (!audio)
    throw new CadenciaMediaError(
      "Este archivo no tiene una pista de audio. Elige un vídeo con voz.",
    );
  const [durationEnd, origin, sampleRate, channels] = await Promise.all([
    input.computeDuration(),
    input.getFirstTimestamp(),
    audio.getSampleRate(),
    audio.getNumberOfChannels(),
  ]);
  const duration = durationEnd - origin;
  if (!Number.isFinite(duration) || duration <= 0.1 || duration > MAX_DURATION)
    throw new CadenciaMediaError(
      "Usa un clip de entre 0,1 segundos y 5 minutos.",
    );
  if (sampleRate < 8000 || sampleRate > 96000 || channels < 1 || channels > 2)
    throw new CadenciaMediaError("Usa audio mono o estéreo, entre 8 y 96 kHz.");
  if (!(await audio.canDecode()) || (video && !(await video.canDecode())))
    throw new CadenciaMediaError(
      "Este navegador no puede decodificar el archivo. Prueba un MP4 H.264/AAC o un WebM en Chrome o Edge.",
    );
  const width = video ? await video.getDisplayWidth() : 0,
    height = video ? await video.getDisplayHeight() : 0;
  if (
    video &&
    (!Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 2 ||
      height < 2 ||
      width * height > 4096 * 2304)
  )
    throw new CadenciaMediaError(
      "Usa un vídeo de hasta 4K para esta primera versión.",
    );
  return {
    duration,
    origin,
    sampleRate,
    channels,
    width,
    height,
    video: !!video,
  };
}

export async function readMedia(
  file: File,
  signal: AbortSignal,
  progress: (fraction: number) => void,
) {
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new CadenciaMediaError("Selecciona un archivo de hasta 250 MB.");
  if (typeof AudioDecoder === "undefined")
    throw new CadenciaMediaError(
      "Tu navegador no dispone del decodificador local. Abre Cadencia en una versión reciente de Chrome o Edge.",
    );
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  const cancel = () => input.dispose();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    checkAbort(signal);
    const info = await inspect(input),
      track = (await input.getPrimaryAudioTrack())!;
    checkAbort(signal);
    const pcm = new Float32Array(Math.ceil(info.duration * ANALYSIS_RATE));
    let lastProgress = -1,
      decodedDuration = 0;
    for await (const { buffer, timestamp } of new AudioBufferSink(
      track,
    ).buffers()) {
      decodedDuration += buffer.duration;
      if (decodedDuration > MAX_DURATION + 2)
        throw new CadenciaMediaError(
          "El audio decodificado supera el límite de cinco minutos.",
        );
      checkAbort(signal);
      const start = Math.max(
        0,
        Math.ceil((timestamp - info.origin) * ANALYSIS_RATE),
      );
      const end = Math.min(
        pcm.length,
        Math.floor((timestamp - info.origin + buffer.duration) * ANALYSIS_RATE),
      );
      const channels = Array.from(
        { length: buffer.numberOfChannels },
        (_, index) => buffer.getChannelData(index),
      );
      for (let i = start; i < end; i++) {
        const position =
          (info.origin + i / ANALYSIS_RATE - timestamp) * buffer.sampleRate;
        const lo = Math.max(
            0,
            Math.min(buffer.length - 1, Math.floor(position)),
          ),
          hi = Math.min(lo + 1, buffer.length - 1),
          fraction = Math.max(0, position - lo);
        let value = 0;
        for (const channel of channels)
          value += channel[lo]! * (1 - fraction) + channel[hi]! * fraction;
        pcm[i] = value / channels.length;
      }
      const fraction = Math.min(
        1,
        (timestamp - info.origin + buffer.duration) / info.duration,
      );
      if (fraction - lastProgress >= 0.02) {
        progress(fraction);
        lastProgress = fraction;
      }
    }
    checkAbort(signal);
    progress(1);
    return { info, pcm };
  } catch (cause) {
    if (signal.aborted) throw stopError();
    if (cause instanceof CadenciaMediaError) throw cause;
    throw new CadenciaMediaError(
      "No se pudo leer el archivo. Prueba un MP4 H.264/AAC, un WebM o un WAV que puedas reproducir.",
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    input.dispose();
  }
}

// Decode source audio at its native rate; selected regions share exactly the same
// compacted timeline as video. Never concatenate compressed packets across cuts.
export async function renderMedia(
  file: File,
  cuts: Cut[],
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<Rendered> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  let output: Output | undefined;
  const cancel = () => {
    input.dispose();
    void output?.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    checkAbort(signal);
    const info = await inspect(input),
      segments = keptSegments(cuts, info.duration);
    const total = segments.reduce((sum, s) => sum + s.end - s.start, 0);
    const ratio = Math.min(1, 1280 / Math.max(info.width, info.height));
    const width = Math.max(2, Math.floor((info.width * ratio) / 2) * 2),
      height = Math.max(2, Math.floor((info.height * ratio) / 2) * 2);
    const mp4 =
      (await canEncodeAudio("aac", {
        sampleRate: info.sampleRate,
        numberOfChannels: info.channels,
      })) &&
      (!info.video ||
        (await canEncodeVideo("avc", { width, height, frameRate: 30 })));
    if (
      !mp4 &&
      (!(await canEncodeAudio("opus", {
        sampleRate: info.sampleRate,
        numberOfChannels: info.channels,
      })) ||
        (info.video &&
          !(await canEncodeVideo("vp9", { width, height, frameRate: 30 }))))
    )
      throw new CadenciaMediaError(
        "El navegador puede analizar el clip, pero no exportarlo con estos códecs. Prueba Chrome o Edge.",
      );
    checkAbort(signal);
    const target = new BufferTarget();
    output = new Output({
      format: mp4
        ? new Mp4OutputFormat({ fastStart: "in-memory" })
        : new WebMOutputFormat(),
      target,
    });
    const audio = new AudioBufferSource({
      codec: mp4 ? "aac" : "opus",
      quality: new Quality({ bitrate: 160000 }),
    });
    output.addAudioTrack(audio);
    const videoTrack = await input.getPrimaryVideoTrack();
    const canvas = info.video ? new OffscreenCanvas(width, height) : null;
    const video = canvas
      ? new CanvasSource(canvas, {
          codec: mp4 ? "avc" : "vp9",
          quality: new Quality({ bitrate: 2500000 }),
          keyFrameInterval: 1,
        })
      : null;
    if (video) output.addVideoTrack(video, { frameRate: 30 });
    await output.start();
    let audioDone = 0,
      videoDone = info.video ? 0 : 1;
    let lastProgress = -1;
    const update = () => {
      const value = (audioDone + videoDone) / 2;
      if (value - lastProgress >= 0.01 || value === 1) {
        progress(value);
        lastProgress = value;
      }
    };
    const audioWork = async () => {
      const sink = new AudioBufferSink((await input.getPrimaryAudioTrack())!);
      let written = 0,
        decodedDuration = 0;
      const appendSilence = async (frames: number) => {
        while (frames > 0) {
          checkAbort(signal);
          const length = Math.min(frames, info.sampleRate);
          await audio.add(
            new AudioBuffer({
              length,
              numberOfChannels: info.channels,
              sampleRate: info.sampleRate,
            }),
          );
          frames -= length;
          written += length;
        }
      };
      for await (const { buffer, timestamp } of sink.buffers()) {
        checkAbort(signal);
        decodedDuration += buffer.duration;
        if (decodedDuration > MAX_DURATION + 2)
          throw new CadenciaMediaError(
            "El audio decodificado supera el límite de cinco minutos.",
          );
        const sourceStart = timestamp - info.origin,
          sourceEnd = sourceStart + buffer.duration;
        for (const segment of segments) {
          if (segment.end <= sourceStart || segment.start >= sourceEnd)
            continue;
          let first = Math.max(
            0,
            Math.round((segment.start - sourceStart) * buffer.sampleRate),
          );
          const last = Math.min(
            buffer.length,
            Math.round((segment.end - sourceStart) * buffer.sampleRate),
          );
          const expected = Math.round(
            (segment.output +
              sourceStart +
              first / buffer.sampleRate -
              segment.start) *
              info.sampleRate,
          );
          if (expected > written) await appendSilence(expected - written);
          if (expected < written) first += written - expected;
          const length = last - first;
          if (length <= 0) continue;
          const part = new AudioBuffer({
            length,
            numberOfChannels: info.channels,
            sampleRate: info.sampleRate,
          });
          for (let channel = 0; channel < info.channels; channel++) {
            const source = buffer.getChannelData(channel),
              destination = part.getChannelData(channel);
            for (let i = 0; i < length; i++) {
              const at = sourceStart + (first + i) / info.sampleRate;
              // Five-millisecond fades suppress sample discontinuities without changing timing.
              const gain = Math.max(
                0,
                Math.min(
                  1,
                  (at - segment.start) / 0.005,
                  (segment.end - at) / 0.005,
                ),
              );
              destination[i] = source[first + i]! * gain;
            }
          }
          await audio.add(part);
          written += length;
        }
        audioDone = Math.min(1, sourceEnd / info.duration);
        update();
      }
      const targetFrames = Math.round(total * info.sampleRate);
      if (written < targetFrames) await appendSilence(targetFrames - written);
      audio.close();
      audioDone = 1;
      update();
    };
    const videoWork = async () => {
      if (!videoTrack || !video || !canvas) return;
      const sink = new CanvasSink(videoTrack, {
        width,
        height,
        fit: "contain",
        poolSize: 2,
      });
      const count = Math.ceil(total * 30);
      function* timestamps() {
        for (let i = 0; i < count; i++)
          yield info.origin +
            sourceTime(segments, Math.min(total - 0.00001, i / 30));
      }
      const context = canvas.getContext("2d")!;
      let index = 0;
      for await (const frame of sink.canvasesAtTimestamps(timestamps())) {
        checkAbort(signal);
        if (!frame)
          throw new CadenciaMediaError(
            "Falta un fotograma del vídeo. No se ha creado una exportación incompleta.",
          );
        context.drawImage(frame.canvas, 0, 0, width, height);
        await video.add(index / 30, Math.min(1 / 30, total - index / 30));
        index++;
        videoDone = index / count;
        update();
      }
      video.close();
      videoDone = 1;
      update();
    };
    await Promise.all([audioWork(), videoWork()]);
    checkAbort(signal);
    await output.finalize();
    checkAbort(signal);
    if (
      !target.buffer?.byteLength ||
      target.buffer.byteLength > 200 * 1024 * 1024
    )
      throw new CadenciaMediaError(
        "El archivo de salida supera el límite de esta versión.",
      );
    return {
      blob: new Blob([target.buffer], {
        type: mp4
          ? info.video
            ? "video/mp4"
            : "audio/mp4"
          : info.video
            ? "video/webm"
            : "audio/webm",
      }),
      extension: mp4 ? (info.video ? "mp4" : "m4a") : "webm",
      duration: total,
      format: mp4 ? (info.video ? "MP4" : "M4A") : "WebM",
    };
  } catch (error) {
    await output?.cancel().catch(() => {});
    if (signal.aborted) throw stopError();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    input.dispose();
  }
}

export async function createDemo(
  audioBlob: Blob,
  signal: AbortSignal,
): Promise<File> {
  const decode = new AudioContext();
  let output: Output | undefined;
  try {
    const audioBuffer = await decode.decodeAudioData(
      await audioBlob.arrayBuffer(),
    );
    checkAbort(signal);
    const mp4 =
      (await canEncodeVideo("avc", {
        width: 640,
        height: 360,
        frameRate: 24,
      })) &&
      (await canEncodeAudio("aac", {
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: audioBuffer.numberOfChannels,
      }));
    const target = new BufferTarget();
    output = new Output({
      format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target,
    });
    const canvas = new OffscreenCanvas(640, 360),
      context = canvas.getContext("2d")!;
    const video = new CanvasSource(canvas, {
      codec: mp4 ? "avc" : "vp9",
      quality: new Quality({ bitrate: 700000 }),
    });
    const audio = new AudioBufferSource({
      codec: mp4 ? "aac" : "opus",
      quality: new Quality({ bitrate: 128000 }),
    });
    output.addVideoTrack(video, { frameRate: 24 });
    output.addAudioTrack(audio);
    await output.start();
    const audioWork = audio.add(audioBuffer).then(() => audio.close());
    void audioWork.catch(() => {}); // Observe an early encoder failure while video is being added.
    for (let i = 0; i < Math.ceil(audioBuffer.duration * 24); i++) {
      checkAbort(signal);
      const time = i / 24;
      context.fillStyle = "#e5e9df";
      context.fillRect(0, 0, 640, 360);
      context.fillStyle = "#243e2c";
      context.font = "500 54px sans-serif";
      context.fillText("Cadencia", 42, 90);
      context.font = "20px sans-serif";
      context.fillText("Demostración · voz y vocal sintetizadas", 44, 133);
      for (let bar = 0; bar < 72; bar++) {
        const pos = Math.min(
          audioBuffer.length - 1,
          Math.floor((time + bar * 0.006) * audioBuffer.sampleRate),
        );
        const height = Math.max(
          4,
          Math.abs(audioBuffer.getChannelData(0)[pos]!) * 160,
        );
        context.fillRect(44 + bar * 7.5, 224 - height / 2, 3, height);
      }
      context.font = "16px monospace";
      context.fillText(`${time.toFixed(2)} s`, 44, 310);
      await video.add(time, Math.min(1 / 24, audioBuffer.duration - time));
    }
    video.close();
    await audioWork;
    await output.finalize();
    checkAbort(signal);
    return new File([target.buffer!], `cadencia-demo.${mp4 ? "mp4" : "webm"}`, {
      type: mp4 ? "video/mp4" : "video/webm",
    });
  } catch (error) {
    await output?.cancel().catch(() => {});
    throw error;
  } finally {
    await decode.close();
  }
}
