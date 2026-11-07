import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  MICO_AVATAR_PALETTES,
  MICO_AVATAR_SHAPES,
  micoAvatarShape,
  withMicoAvatarPalette,
  withMicoAvatarShape,
} from "@rakazo/contracts";
import {
  BotAvatar,
  BotShapePreview,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  defaultBotAvatarValue,
  parseBotAvatar,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@rakazo/ui-web";
import { Button } from "@rakazo/ui-web/components/ui/button";
import { Check, Pencil, Upload, X } from "lucide-react";
import type { ClipboardEvent, DragEvent } from "react";
import { useRef, useState } from "react";

export function BotLookPicker({
  value,
  onAutomatic,
  onChange,
}: {
  value: string;
  onAutomatic?: () => void;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  const parsed = parseBotAvatar(value);
  const activeShape = micoAvatarShape(parsed.shapeIndex);
  const shapeLabels = {
    mushroom: t`Mushroom`,
    fox: t`Fox`,
    hedgehog: t`Hedgehog`,
    frog: t`Frog`,
    moth: t`Moth`,
    snail: t`Snail`,
    owl: t`Owl`,
    turtle: t`Turtle`,
    axolotl: t`Axolotl`,
    crab: t`Crab`,
    fish: t`Fish`,
    octopus: t`Octopus`,
  };
  const paletteLabels = {
    violet: t`Violet`,
    tangerine: t`Tangerine`,
    honey: t`Honey`,
    lime: t`Lime`,
    indigo: t`Indigo`,
    turquoise: t`Turquoise`,
    raspberry: t`Raspberry`,
    mint: t`Mint`,
    lavender: t`Lavender`,
    coral: t`Coral`,
    sky: t`Sky blue`,
    slate: t`Slate`,
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex min-h-8 items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>Shape</Trans>
          </span>
          {onAutomatic ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              aria-pressed={!value}
              onClick={onAutomatic}
              className={!value ? "bg-secondary text-foreground" : "text-muted-foreground"}
            >
              <Trans>Automatic</Trans>
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-6 place-items-center gap-y-2 max-[359px]:grid-cols-4">
          {MICO_AVATAR_SHAPES.map(({ id, index }) => {
            const next = withMicoAvatarShape(value, index);
            return (
              <BotShapePreview
                key={id}
                shapeIndex={index}
                label={shapeLabels[id]}
                color={parseBotAvatar(next).color}
                selected={activeShape?.index === index}
                onClick={() => onChange(next)}
              />
            );
          })}
        </div>
      </div>

      <div className="border-t border-border pt-2">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          <Trans>Color</Trans>
        </div>
        <div className="grid grid-cols-6 place-items-center gap-y-1 max-[359px]:grid-cols-4">
          {MICO_AVATAR_PALETTES.map(({ id, color }) => {
            const selected = Boolean(activeShape) && parsed.color.toUpperCase() === color;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(withMicoAvatarPalette(value, color))}
                aria-label={paletteLabels[id]}
                title={paletteLabels[id]}
                aria-pressed={selected}
                className="grid size-10 cursor-pointer place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={`size-6 rounded-full border ${
                    selected
                      ? "border-transparent ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                      : "border-border"
                  }`}
                  style={{ backgroundColor: color }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface AvatarStudioPopoverProps {
  value: string;
  identity?: string;
  status?: string;
  size?: number;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function AvatarStudioPopover({
  value,
  identity,
  status,
  size = 72,
  onChange,
  disabled = false,
}: AvatarStudioPopoverProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"bot" | "upload">("bot");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function restoreDefaultAvatar() {
    const next = defaultBotAvatarValue(value);
    if (next !== value) onChange(next);
  }

  function processImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const targetSize = 256;
        canvas.width = targetSize;
        canvas.height = targetSize;
        if (!ctx) return;

        ctx.beginPath();
        ctx.arc(targetSize / 2, targetSize / 2, targetSize / 2, 0, Math.PI * 2);
        ctx.clip();

        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);

        onChange(canvas.toDataURL("image/webp", 0.9));
        setOpen(false);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLButtonElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item?.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) {
        processImageFile(file);
        break;
      }
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="group relative cursor-pointer rounded-2xl outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t`Customize bot avatar`}
        data-testid="avatar-studio-trigger"
      >
        <BotAvatar color={value} identity={identity} size={size} status={status} />
        <div className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border-2 border-background bg-secondary text-foreground shadow-md transition-transform group-hover:scale-110">
          <Pencil size={12} strokeWidth={2.2} />
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] w-[360px] max-w-[calc(100%-2rem)] gap-4 overflow-y-auto rounded-3xl p-5 sm:max-w-[360px]"
          data-testid="avatar-studio"
        >
          <DialogHeader className="flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-[14px] font-semibold tracking-tight">
              <Trans>Avatar Studio</Trans>
            </DialogTitle>
            <DialogDescription className="sr-only">
              <Trans>Choose a bot shape, color, or upload an image</Trans>
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full text-muted-foreground"
              aria-label={t`Close`}
            >
              <X size={16} />
            </Button>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-2">
            <BotAvatar color={value} identity={identity} size={78} status={status} />
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(next) => setActiveTab(next as "bot" | "upload")}
            className="gap-4"
          >
            <div className="flex items-center justify-between border-b border-border pb-1">
              <TabsList className="rounded-full">
                <TabsTrigger value="bot" className="rounded-full px-3 text-xs">
                  <Trans>Bot</Trans>
                </TabsTrigger>
                <TabsTrigger value="upload" className="rounded-full px-3 text-xs">
                  <Trans>Upload</Trans>
                </TabsTrigger>
              </TabsList>

              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={restoreDefaultAvatar}
                className="text-xs text-muted-foreground"
              >
                <Trans>Reset</Trans>
              </Button>
            </div>

            <TabsContent value="bot" className="pt-1" data-testid="avatar-studio-bot-tab">
              <BotLookPicker value={value} onChange={onChange} />
            </TabsContent>
            <TabsContent value="upload">
              <button
                type="button"
                aria-label={t`Image upload area`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onPaste={handlePaste}
                onClick={() => fileInputRef.current?.click()}
                className={`flex w-full flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted hover:border-foreground/30"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) processImageFile(file);
                  }}
                />
                <div className="mb-2 grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <Upload size={18} strokeWidth={1.8} />
                </div>
                <p className="text-[12.5px] font-medium text-muted-foreground">
                  <Trans>Drag, drop, or paste an image</Trans>
                </p>
                <span className="mt-3 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground">
                  <Trans>Choose file</Trans>
                </span>
              </button>
            </TabsContent>
          </Tabs>

          <DialogFooter className="border-border sm:justify-end">
            <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>
              <Check size={14} />
              <Trans>Done</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
