import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  MICO_AVATAR_PALETTES,
  MICO_AVATAR_SHAPES,
  micoAvatarDetails,
  micoAvatarShape,
  micoAvatarValue,
  withMicoAvatarPalette,
  withMicoAvatarShape,
} from "@rakazo/contracts";
import { currentMicoAvatarValue } from "@rakazo/core";
import {
  BotAvatar,
  BotShapePreview,
  MicoEyePreview,
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
  identity,
  onAutomatic,
  onChange,
}: {
  value: string;
  identity?: string;
  onAutomatic?: () => void;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  const parsed = parseBotAvatar(value);
  const details = micoAvatarDetails(value);
  const displayedValue = currentMicoAvatarValue(value, identity);
  const displayed = parseBotAvatar(displayedValue);
  const activeShape = micoAvatarShape(identity ? displayed.shapeIndex : parsed.shapeIndex);
  const choiceValue = identity ? displayedValue : value;
  function updateDetails(next: typeof details) {
    onChange(micoAvatarValue(displayed.shapeIndex ?? MICO_AVATAR_SHAPES[0].index, displayed.color, next));
  }
  const shapeLabels = {
    mushroom: t({ id: "Mushroom", message: "Mushroom" }),
    fox: t({ id: "Fox", message: "Fox" }),
    hedgehog: t({ id: "Hedgehog", message: "Hedgehog" }),
    frog: t({ id: "Frog", message: "Frog" }),
    moth: t({ id: "Moth", message: "Moth" }),
    snail: t({ id: "Snail", message: "Snail" }),
    owl: t({ id: "Owl", message: "Owl" }),
    turtle: t({ id: "Turtle", message: "Turtle" }),
    axolotl: t({ id: "Axolotl", message: "Axolotl" }),
    crab: t({ id: "Crab", message: "Crab" }),
    fish: t({ id: "Fish", message: "Fish" }),
    octopus: t({ id: "Octopus", message: "Octopus" }),
  };
  const paletteLabels = {
    violet: t({ id: "Violet", message: "Violet" }),
    tangerine: t({ id: "Tangerine", message: "Tangerine" }),
    honey: t({ id: "Honey", message: "Honey" }),
    lime: t({ id: "Lime", message: "Lime" }),
    indigo: t({ id: "Indigo", message: "Indigo" }),
    turquoise: t({ id: "Turquoise", message: "Turquoise" }),
    raspberry: t({ id: "Raspberry", message: "Raspberry" }),
    mint: t({ id: "Mint", message: "Mint" }),
    lavender: t({ id: "Lavender", message: "Lavender" }),
    coral: t({ id: "Coral", message: "Coral" }),
    sky: t({ id: "Sky blue", message: "Sky blue" }),
    slate: t({ id: "Slate", message: "Slate" }),
    red: t`Red`,
    navy: t`Navy blue`,
    sand: t`Sand`,
    wine: t`Wine`,
    gray: t`Gray`,
  };
  const eyeLabels = [
    t`Calm`, t`Alert`, t`Curious`, t`Surprised`,
    t`Happy`, t`Laughing`, t`Sleepy`, t`Dreamy`,
    t`Shy`, t`Proud`, t`Mischievous`, t`Skeptical`,
    t`Sad`, t`Angry`, t`Confused`, t`Star`,
  ];

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
            const next = withMicoAvatarShape(choiceValue, index);
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
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground"><Trans>Color</Trans></span>
          <Button
            type="button"
            size="sm"
            variant={details.original && !parsed.isImage ? "secondary" : "ghost"}
            aria-pressed={details.original && !parsed.isImage}
            onClick={() => updateDetails({ ...details, original: true })}
          >
            <Trans>Original colors</Trans>
          </Button>
        </div>
        <div className="grid grid-cols-6 place-items-center gap-y-1 max-[359px]:grid-cols-4">
          {MICO_AVATAR_PALETTES.map(({ id, color }) => {
            const selected = !details.original && Boolean(activeShape) && displayed.color.toUpperCase() === color;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(withMicoAvatarPalette(choiceValue, color))}
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

      <fieldset className="min-w-0 border-t border-border pt-2">
        <legend className="pr-2 text-xs font-medium text-muted-foreground"><Trans>Eyes</Trans></legend>
        <div className="grid grid-cols-8 place-items-center gap-y-1 max-[359px]:grid-cols-4">
          {eyeLabels.map((label, eyes) => (
            <button
              key={eyes}
              type="button"
              aria-label={label}
              aria-pressed={details.eyes === eyes && !parsed.isImage}
              title={label}
              className="grid size-9 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-secondary aria-pressed:bg-secondary aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => updateDetails({ ...details, eyes })}
            >
              <MicoEyePreview eyes={eyes} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0 border-t border-border pt-2">
        <legend className="pr-2 text-xs font-medium text-muted-foreground"><Trans>Finish</Trans></legend>
        <div className="flex gap-2">
          {(["flat", "plush"] as const).map((finish) => (
            <Button
              key={finish}
              type="button"
              size="sm"
              variant={details.finish === finish && !parsed.isImage ? "secondary" : "ghost"}
              aria-pressed={details.finish === finish && !parsed.isImage}
              onClick={() => updateDetails({ ...details, finish })}
            >
              {finish === "flat" ? <Trans>Flat</Trans> : <Trans>Velvety</Trans>}
            </Button>
          ))}
        </div>
      </fieldset>
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
        className="group relative cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <Trans>Choose a shape, color, eyes and finish, or upload an image</Trans>
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
                  <Trans id="Bot">Mico</Trans>
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
              <BotLookPicker value={value} identity={identity} onChange={onChange} />
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
