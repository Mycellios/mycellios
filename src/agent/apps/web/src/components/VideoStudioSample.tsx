import { Film } from "lucide-react";
import { useEffect, useState } from "react";
import { videoStudioFrames } from "../lib/video-studio-frames";

const sampleScenes = [
  { title: "Un balcón lleno de vida", narration: "Tres ideas para empezar tu propio jardín." },
  { title: "Empieza con aromáticas", narration: "La menta y la albahaca crecen bien en macetas." },
];

export function VideoStudioSample() {
  const [frames, setFrames] = useState<string[]>([]);

  useEffect(() => {
    try {
      setFrames(videoStudioFrames(sampleScenes));
    } catch {
      // The example is decorative. The studio still works without this preview.
    }
  }, []);

  return (
    <figure className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4 rounded-xl bg-success/10 p-4 sm:p-5">
      <figcaption className="min-w-0">
        <Film size={19} className="mb-2 text-success" aria-hidden="true" />
        <span className="block text-sm font-semibold">Ejemplo de resultado</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">MP4 vertical · 6 escenas · con voz</span>
      </figcaption>
      {frames.length ? (
        <div className="flex gap-2" aria-hidden="true">
          {frames.map((src, index) => (
            <img key={index} src={src} alt="" width={72} height={128} className="aspect-[9/16] w-[4.5rem] rounded-md border border-border" />
          ))}
        </div>
      ) : null}
    </figure>
  );
}
