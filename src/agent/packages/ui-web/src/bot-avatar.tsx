import { MICO_AVATAR_SHAPES, micoAvatarDetails, micoAvatarShape, micoAvatarValue, parseBotAvatarValue } from "@rakazo/contracts";
import type { BotColorDef } from "@rakazo/core";
import {
  ACTIVE_RUN_STATUSES,
  avatarIdentitySeed,
  BOT_AVATAR_COLORS,
  BOT_COLOR_LIST,
  currentMicoAvatarValue,
  DEFAULT_BOT_AVATAR_COLOR,
  MICO_AVATAR_EYE_COLOR,
  MICO_AVATAR_VIEWBOX,
  micoAvatarArt,
  organicAvatarPath,
  resolvePersonaColorDef,
  SHIPPED_BOT_AVATAR_CENTER,
  SHIPPED_BOT_AVATAR_SHAPE_KEYS,
  SHIPPED_BOT_AVATAR_SHAPES,
  SHIPPED_BOT_AVATAR_VIEWBOX,
  shippedBotAvatarShapePath,
} from "@rakazo/core";
import { tokens } from "@rakazo/ui-tokens";
import type { CSSProperties } from "react";
import { memo, useId, useMemo, useSyncExternalStore } from "react";
import { cn } from "./lib/utils.js";
import { MICO_EYE_PATHS, MICO_PLUSH_CROPS } from "./mico-avatar-sprites.js";
import "./styles.css";

export type { BotColorDef };
export { BOT_AVATAR_COLORS, BOT_COLOR_LIST, DEFAULT_BOT_AVATAR_COLOR, resolvePersonaColorDef };

export const BOT_SHAPES = SHIPPED_BOT_AVATAR_SHAPES;
export const SHIPPED_SHAPE_KEYS = SHIPPED_BOT_AVATAR_SHAPE_KEYS;
const VIEWBOX = SHIPPED_BOT_AVATAR_VIEWBOX;
const CENTER = SHIPPED_BOT_AVATAR_CENTER;

export const BOT_MASCOT_SHAPES = SHIPPED_SHAPE_KEYS.map(
  (k) => BOT_SHAPES[k] ?? FALLBACK_SHAPE_PATH,
);

const FALLBACK_SHAPE_PATH = BOT_SHAPES.hex ?? "";

export function parseBotAvatar(
  rawColor: string,
  _identity?: string,
): {
  color: string;
  shapeIndex?: number;
  isImage: boolean;
  imageUrl?: string;
} {
  if (!rawColor) return { color: "#F97316", isImage: false };
  // Only data: image URLs are rendered. Arbitrary http(s)/blob values in `color`
  // must not become <img src> (SSRF / tracking when other members view the bot).
  const parsed = parseBotAvatarValue(rawColor);
  if (parsed.kind === "image") return { color: "#F97316", isImage: true, imageUrl: parsed.imageUrl };
  if (parsed.kind === "shape") {
    return { color: parsed.color, shapeIndex: parsed.shapeIndex, isImage: false };
  }
  return { color: rawColor, isImage: false };
}

const AVATAR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultBotAvatarValue(rawColor: string): string {
  const parsed = parseBotAvatar(rawColor);
  if (rawColor && !parsed.isImage && AVATAR_HEX.test(parsed.color)) return parsed.color;
  return DEFAULT_BOT_AVATAR_COLOR;
}

export interface BotAvatarProps {
  color: string;
  size?: number;
  status?: string;
  identity?: string;
  className?: string;
}

export const BotAvatar = memo(function BotAvatar({
  color,
  size = 36,
  status,
  identity = "",
  className,
}: BotAvatarProps) {
  const id = useId().replace(/[^a-zA-Z0-9-_]/g, "");
  const isWorking = ACTIVE_RUN_STATUSES.some((s) => s === status);

  const displayedValue = useMemo(() => currentMicoAvatarValue(color, identity), [color, identity]);
  const parsed = useMemo(() => parseBotAvatar(displayedValue), [displayedValue]);
  const effectiveId = identity || parsed.color || "agent";

  const colorDef = useMemo(
    () => resolvePersonaColorDef(effectiveId, parsed.color),
    [effectiveId, parsed.color],
  );

  if (parsed.isImage && parsed.imageUrl) {
    return (
      <div
        className={cn("rakazo-bot-avatar relative shrink-0 select-none", className)}
        data-working={isWorking}
        style={{ width: size, height: size }}
      >
        <div className="rakazo-bot-avatar-picture relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-secondary">
          <img src={parsed.imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
        {isWorking ? (
          <svg
            className="rakazo-bot-avatar-ring rakazo-bot-avatar-ring-working absolute z-10 pointer-events-none"
            style={{
              inset: -4,
              width: size + 8,
              height: size + 8,
            }}
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="24"
              cy="24"
              r="22"
              className="stroke-status-working"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeDasharray="45 80"
            />
          </svg>
        ) : null}
      </div>
    );
  }

  if (parsed.shapeIndex === undefined) {
    return (
      <OrganicAvatar
        color={colorDef.hex}
        identity={effectiveId}
        size={size}
        isWorking={isWorking}
        className={className}
      />
    );
  }

  const look = micoAvatarDetails(displayedValue);
  const shape = micoAvatarShape(parsed.shapeIndex);
  const shapeOrdinal = MICO_AVATAR_SHAPES.findIndex(({ index }) => index === parsed.shapeIndex);
  const mico = micoAvatarArt(parsed.shapeIndex, look.original ? shape?.originalColor ?? parsed.color : parsed.color);
  const plush = look.finish === "plush" ? MICO_PLUSH_CROPS[shapeOrdinal] : undefined;
  if (mico && !plush) {
    return (
      <svg
        className={cn("rakazo-bot-avatar shrink-0 select-none", className)}
        viewBox={MICO_AVATAR_VIEWBOX}
        aria-hidden="true"
        data-working={isWorking}
        data-mico-avatar="flat"
        data-mico-shape={shape?.id}
        data-mico-idle={identity ? "" : undefined}
        style={{
          width: size,
          height: size,
          "--mico-blink-delay": `-${(avatarIdentitySeed(effectiveId) % 7000) / 1000}s`,
        } as CSSProperties}
      >
        <path d={mico.path} fill={mico.color} className="rakazo-mico-body" />
        {mico.nose && <path d={mico.nose} fill={MICO_AVATAR_EYE_COLOR} />}
        {look.eyes === 0 ? (
          <g className="rakazo-mico-gaze" fill={mico.eyeColor}>
            {mico.eyes.map(([x, y, width, height]) => (
              <rect key={x} className="rakazo-mico-eye" x={x} y={y} width={width} height={height} rx={width / 2} />
            ))}
          </g>
        ) : (
          <MicoEyes
            eyes={look.eyes}
            positions={mico.eyes.map(([x, y, width, height]) => [x + width / 2, y + height / 2] as const)}
            scale={0.24}
            color={mico.eyeColor}
          />
        )}
      </svg>
    );
  }
  return (
    <div
      className={cn(
        "rakazo-bot-avatar bot-avatar-container relative inline-flex items-center justify-center shrink-0 select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
      }}
      data-working={isWorking}
      data-mico-avatar={plush ? "plush" : undefined}
    >
      <svg
        className="rakazo-bot-avatar-ring absolute pointer-events-none"
        style={{
          inset: -4,
          width: size + 8,
          height: size + 8,
          filter: `drop-shadow(0 0 6px ${colorDef.light}) drop-shadow(0 0 10px #ffffff)`,
        }}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="24"
          cy="24"
          r="22"
          stroke={`url(#${id}-ring)`}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray="45 80"
        />
        <circle cx="43" cy="24" r="2.8" fill="#ffffff" />
        <defs>
          <linearGradient id={`${id}-ring`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="60%" stopColor={colorDef.light} stopOpacity="0.9" />
            <stop offset="100%" stopColor={colorDef.light} stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <svg
        viewBox={plush?.[0] ?? (mico ? MICO_AVATAR_VIEWBOX : VIEWBOX)}
        aria-hidden="true"
        className={cn(
          plush ? "overflow-hidden" : "overflow-visible",
          !mico && "transition-transform duration-300",
          !mico && (isWorking
            ? "animate-pulse scale-[1.04] motion-reduce:animate-none"
            : "hover:scale-[1.03] motion-reduce:hover:scale-100"),
        )}
        // Inline size so a parent's icon sizing (Button sizes bare SVGs) cannot shrink it.
        style={{
          width: size,
          height: size,
          filter: isWorking
            ? `drop-shadow(0 0 8px ${colorDef.light}) drop-shadow(0 0 2px #ffffff)`
            : mico
              ? "drop-shadow(0 1px 1.5px rgba(32,24,28,0.22))"
              : "drop-shadow(0 2px 4px rgba(0,0,0,0.45))",
        }}
      >
        {plush && mico ? (
          <>
            <MicoPlushBody id={id} tint={look.original ? undefined : mico.color} firstSheet={shapeOrdinal < 5} />
            <MicoEyes
              eyes={look.eyes}
              positions={[plush[1], plush[2]]}
              scale={1.9}
              color="#30201e"
              plush
            />
          </>
        ) : (
          <>
            <defs>
              <linearGradient id={`bot-ink-${id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={colorDef.light} />
                <stop offset="100%" stopColor={colorDef.dark} />
              </linearGradient>
            </defs>
            <g>
              <path d={shippedBotAvatarShapePath(parsed.shapeIndex)} fill={`url(#bot-ink-${id})`} />
              <g fill={colorDef.eyeColor} className="bot-character-eyes">
                <ellipse cx={CENTER - 29} cy={CENTER - 8} rx={10} ry={7} />
                <ellipse cx={CENTER + 29} cy={CENTER - 8} rx={10} ry={7} />
              </g>
            </g>
          </>
        )}
      </svg>
    </div>
  );
});

const plushSheets = {
  first: new URL("./assets/micos-terciopelo-base.png", import.meta.url).href,
  second: new URL("./assets/micos-terciopelo-coleccion.png", import.meta.url).href,
};

function MicoPlushBody({ id, tint, firstSheet }: { id: string; tint?: string; firstSheet: boolean }) {
  const filterId = `${id}-plush`;
  const tables = tint && [1, 3, 5].map((offset) => {
    const value = Number.parseInt(tint.slice(offset, offset + 2), 16) / 255;
    return [0, 0.16 * value, 0.52 * value, 0.94 * value, 0.43 + 0.57 * value, 1].join(" ");
  });
  return (
    <>
      {tables && <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues={tables[0]} />
            <feFuncG type="table" tableValues={tables[1]} />
            <feFuncB type="table" tableValues={tables[2]} />
          </feComponentTransfer>
        </filter>
      </defs>}
      <image
        href={firstSheet ? plushSheets.first : plushSheets.second}
        width={firstSheet ? 2048 : 1774}
        height={firstSheet ? 683 : 887}
        filter={tables ? `url(#${filterId})` : undefined}
      />
    </>
  );
}

function MicoEyes({ eyes, positions, scale, color, plush = false }: {
  eyes: number;
  positions: readonly (readonly [number, number])[];
  scale: number;
  color: string;
  plush?: boolean;
}) {
  return (
    <g className="rakazo-mico-gaze" fill={color} stroke={plush ? "#f9ead288" : undefined}>
      {positions.map(([x, y], index) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${index ? -scale : scale} ${scale})`}>
          <path className="rakazo-mico-eye" d={MICO_EYE_PATHS[eyes] ?? MICO_EYE_PATHS[0]} />
        </g>
      ))}
    </g>
  );
}

export function MicoEyePreview({ eyes }: { eyes: number }) {
  const path = MICO_EYE_PATHS[eyes] ?? MICO_EYE_PATHS[0];
  return (
    <svg viewBox="0 0 64 32" className="h-4 w-8" aria-hidden="true" fill="currentColor">
      <path transform="translate(19 16) scale(.72)" d={path} />
      <path transform="translate(45 16) scale(-.72 .72)" d={path} />
    </svg>
  );
}

function OrganicAvatar({
  color,
  identity,
  size,
  isWorking,
  className,
}: {
  color: string;
  identity?: string;
  size: number;
  isWorking: boolean;
  className?: string;
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
  const seed = avatarIdentitySeed(identity || color || DEFAULT_BOT_AVATAR_COLOR);
  const duration = `${4.8 + (seed % 24) / 10}s`;
  const shapeA = organicAvatarPath(seed);
  const shapeB = organicAvatarPath(seed, 0.42);

  return (
    <svg
      viewBox="-60 -60 120 120"
      aria-hidden="true"
      className={cn("rakazo-organic-avatar overflow-visible select-none", className)}
      data-working={isWorking}
      data-shape-family={seed % 10}
      data-eye-pattern={seed % 4}
      style={{
        width: size,
        height: size,
        flex: "none",
      }}
    >
      {(["idle", "working"] as const).map((mode) => (
        <path
          key={mode}
          className={`rakazo-organic-avatar-body rakazo-organic-avatar-body-${mode}`}
          d={shapeA}
          fill={color}
          style={
            {
              "--rakazo-organic-path": `path("${shapeA}")`,
              filter:
                mode === "working"
                  ? `drop-shadow(0 0 ${Math.round(size * 0.16)}px ${color})`
                  : "drop-shadow(0 2px 3px rgba(0,0,0,.34))",
            } as CSSProperties
          }
        >
          {!reducedMotion ? (
            <animate
              attributeName="d"
              values={`${shapeA};${shapeB};${shapeA}`}
              dur={duration}
              repeatCount="indefinite"
            />
          ) : null}
        </path>
      ))}
      <g transform={`rotate(${(seed % 9) - 4})`}>
        {(["idle", "working"] as const).map((mode) => (
          <g
            key={mode}
            className={`rakazo-organic-avatar-eyes rakazo-organic-avatar-eyes-${mode}`}
            fill={tokens.background}
          >
            <rect x="-14" y="-12" width="7" height="24" rx="3.5" />
            <rect x="7" y="-12" width="7" height="24" rx="3.5" />
          </g>
        ))}
      </g>
    </svg>
  );
}

const reducedMotionMedia = "(prefers-reduced-motion: reduce)";

function reducedMotionSnapshot(): boolean {
  return window.matchMedia(reducedMotionMedia).matches;
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia(reducedMotionMedia);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function BotShapePreview({
  shapeIndex,
  identity,
  label,
  color,
  selected,
  compact = false,
  onClick,
}: {
  /** An Avatar Studio shape; omit it to draw the organic body `identity` gets. */
  shapeIndex?: number;
  identity?: string;
  label?: string;
  color: string;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const key =
    shapeIndex === undefined
      ? undefined
      : (SHIPPED_SHAPE_KEYS[shapeIndex % SHIPPED_SHAPE_KEYS.length] ?? "hex");
  const colorDef = resolvePersonaColorDef("preview", color);
  const mico = micoAvatarShape(shapeIndex);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? mico?.id ?? key}
      title={label}
      aria-pressed={selected ?? false}
      className={cn(
        "relative flex cursor-pointer items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
        compact ? "size-8 rounded-lg sm:size-[26px]" : "size-11",
        selected
          ? cn("ring-2 ring-primary bg-white/10", compact ? "ring-inset" : "ring-offset-2 ring-offset-popover")
          : "hover:bg-white/5",
      )}
    >
      {mico ? (
        <BotAvatar color={micoAvatarValue(mico.index, color, { eyes: 0, finish: "flat", original: false })} size={compact ? 22 : 34} />
      ) : shapeIndex === undefined ? (
        <BotAvatar color={color} identity={identity} size={32} />
      ) : (
        <svg viewBox={VIEWBOX} className="size-8 overflow-visible" aria-hidden="true">
          <path d={shippedBotAvatarShapePath(shapeIndex)} fill={colorDef.light} />
          <g fill={colorDef.eyeColor}>
            <ellipse cx={CENTER - 29} cy={CENTER - 8} rx={10} ry={7} />
            <ellipse cx={CENTER + 29} cy={CENTER - 8} rx={10} ry={7} />
          </g>
        </svg>
      )}
    </button>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-full bg-card">
        <span className="h-4 w-[7px] rounded-full bg-primary" />
        <span className="h-4 w-[7px] rounded-full bg-primary" />
      </div>
      <span className="font-[Aeonik,ui-sans-serif] text-[28px] tracking-tight text-foreground">
        Rakazo
      </span>
    </div>
  );
}
