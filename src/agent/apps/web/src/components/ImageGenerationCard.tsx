import { useLingui } from "@lingui/react/macro";
import type { ImageAspectRatio, MessageBlock } from "@rakazo/contracts";
import { Button, cn, Dialog, DialogClose, DialogContent, DialogTitle } from "@rakazo/ui-web";
import { CircleAlert, Download, Maximize2, X } from "lucide-react";
import { useState } from "react";
import type { ArtifactTarget } from "../lib/artifact-open";
import { downloadArtifact } from "../lib/artifact-open";
import { useArtifactImage } from "../lib/use-artifact-image";
import { Shimmer } from "./ai/primitives";
import "./image-generation-card.css";

type ImageGenerationBlock = Extract<MessageBlock, { kind: "image_generation" }>;

/** The stage keeps the requested shape until the real picture tells us its size. */
const PLACEHOLDER_RATIO: Record<ImageAspectRatio, string> = {
  square: "1 / 1",
  portrait: "3 / 4",
  landscape: "4 / 3",
};

/** Image cards hide the plain image block that follows them for older clients. */
export function generatedImageArtifactIds(blocks: readonly MessageBlock[]): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks)
    if (block.kind === "image_generation" && block.status === "completed" && block.artifactId)
      ids.add(block.artifactId);
  return ids;
}

export function ImageGenerationCard({
  block,
  target,
  name,
}: {
  block: ImageGenerationBlock;
  target: ArtifactTarget;
  /** File name of the attached picture, used for downloads. */
  name?: string;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [loaded, setLoaded] = useState<{ width: number; height: number } | null>(null);
  const artifactId = block.status === "completed" ? block.artifactId : undefined;
  const src = useArtifactImage(target, artifactId ?? "", Boolean(artifactId));
  const ready = Boolean(src && loaded);
  const failed = block.status === "failed" || block.status === "interrupted";
  const size =
    loaded ?? (block.width && block.height ? { width: block.width, height: block.height } : null);
  const ratio = failed
    ? "3 / 1"
    : size && block.status === "completed"
      ? `${size.width} / ${size.height}`
      : PLACEHOLDER_RATIO[block.aspectRatio];
  const fileName = name ?? "generated-image.png";

  const label =
    block.status === "generating"
      ? t`Generating image`
      : block.status === "interrupted"
        ? t`Image generation stopped`
        : block.status === "failed"
          ? t`Image generation failed`
          : t`Generated image`;
  const failure =
    block.error ??
    (block.status === "interrupted"
      ? t`The image was not finished.`
      : block.status === "failed"
        ? t`The image could not be generated.`
        : undefined);

  const download = async () => {
    if (!artifactId) return;
    setDownloadFailed(false);
    try {
      await downloadArtifact(target, artifactId, fileName, "image/png");
    } catch {
      setDownloadFailed(true);
    }
  };

  return (
    <section
      className="rk-image-gen"
      data-status={block.status}
      aria-label={label}
      aria-live={block.status === "generating" ? "polite" : undefined}
      aria-busy={block.status === "generating" || (Boolean(artifactId) && !ready) || undefined}
    >
      <div className="rk-image-gen-stage" style={{ aspectRatio: ratio }}>
        <div
          className={cn("rk-image-gen-canvas", ready && "rk-image-gen-canvas-hidden")}
          aria-hidden
        >
          {failed ? (
            <CircleAlert className="rk-image-gen-failure-mark" />
          ) : (
            <>
              <span className="rk-image-gen-dots" />
              <span className="rk-image-gen-glow" />
            </>
          )}
        </div>
        {src ? (
          <button
            type="button"
            className={cn("rk-image-gen-picture", ready && "rk-image-gen-picture-ready")}
            aria-label={t`Open generated image`}
            onClick={() => setOpen(true)}
          >
            <img
              src={src}
              alt={block.prompt ?? t`Generated image`}
              decoding="async"
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth > 0 && image.naturalHeight > 0)
                  setLoaded({ width: image.naturalWidth, height: image.naturalHeight });
              }}
            />
          </button>
        ) : null}
        {ready ? (
          <div className="rk-image-gen-actions">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Download image`}
              title={t`Download image`}
              onClick={() => void download()}
            >
              <Download aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Open generated image`}
              title={t`Open generated image`}
              onClick={() => setOpen(true)}
            >
              <Maximize2 aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="rk-image-gen-meta">
        <span className="rk-image-gen-label">
          {block.status === "generating" ? <Shimmer>{label}</Shimmer> : label}
          {block.status === "completed" && size ? (
            <span className="rk-image-gen-size">{t`${size.width} × ${size.height}`}</span>
          ) : null}
        </span>
        {failure ? (
          <span className="rk-image-gen-error" role="alert">
            {failure}
          </span>
        ) : null}
        {downloadFailed ? (
          <span className="rk-image-gen-error" role="alert">
            {t`Could not download the image. Try again.`}
          </span>
        ) : null}
        {block.prompt ? <span className="rk-image-gen-prompt">{block.prompt}</span> : null}
      </div>
      {src ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            showCloseButton={false}
            className="w-auto max-w-none bg-transparent p-0 ring-0 sm:max-w-none"
          >
            <DialogTitle className="sr-only">{label}</DialogTitle>
            <DialogClose
              aria-label={t`Close image preview`}
              render={<Button variant="ghost" size="icon-sm" className="absolute end-2 top-2" />}
            >
              <X />
            </DialogClose>
            <img
              src={src}
              alt={block.prompt ?? label}
              className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
