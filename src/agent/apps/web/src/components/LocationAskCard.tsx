import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@mycellios/chat-ui/web";
import type { LocationAnswer, LocationAskOutcome } from "@mycellios/contracts";
import { encodeLocationAnswer, LOCATION_PLACE_MAX_LENGTH } from "@mycellios/contracts";
import { Button, Input } from "@mycellios/ui-web";
import { MapPin } from "lucide-react";
import { useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { errorText } from "../lib/user-error";
import type { AskBlock } from "./AskCard";
import { BuiCard } from "./ai/primitives";

const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 15_000,
  maximumAge: 60_000,
};

/**
 * The browser position, read once on the person's click. Desktop denies the permission, so it
 * offers only a typed place.
 */
function canShareDevicePosition(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.geolocation) && !desktopBridge();
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, POSITION_OPTIONS),
  );
}

/**
 * A Mico's one-time location request. Nothing is sent until the person shares the device's
 * position once, types a place or declines; only the run's user sees the controls.
 */
export function LocationAskCard({
  block,
  canAnswer,
  isRunUser,
  onAnswer,
}: {
  block: AskBlock;
  canAnswer: boolean;
  /** Only the person whose turn asked can answer with their location. */
  isRunUser: boolean;
  onAnswer: (text: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [place, setPlace] = useState("");
  const [pending, setPending] = useState<"position" | "place" | "declined" | null>(null);
  const [accepted, setAccepted] = useState<LocationAskOutcome>();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const outcome = block.status === "answered" ? block.location?.outcome : accepted;
  const answered = block.status === "answered" || accepted !== undefined;

  async function send(answer: LocationAnswer, next: LocationAskOutcome) {
    try {
      await onAnswer(encodeLocationAnswer(answer));
      setAccepted(next);
      setPlace("");
    } catch (err) {
      setError(errorText(err, t`Could not submit this answer`));
    }
  }

  async function run(kind: "position" | "place" | "declined", task: () => Promise<void>) {
    // Only a card the server marked as a location request takes one: a server that does not
    // know the card would keep the answer as ordinary text.
    if (busy.current || !block.location) return;
    busy.current = true;
    setPending(kind);
    setError(null);
    try {
      await task();
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function shareOnce() {
    void run("position", async () => {
      let position: GeolocationPosition;
      try {
        position = await currentPosition();
      } catch (err) {
        const denied = (err as GeolocationPositionError | undefined)?.code === 1;
        setError(
          denied
            ? t`Location access is off. Type a place instead.`
            : t`Your location is unavailable. Type a place instead.`,
        );
        return;
      }
      await send(
        {
          kind: "position",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        },
        "shared",
      );
    });
  }

  return (
    <BuiCard
      data-testid="location-ask-card"
      className="w-full min-w-0 max-w-md rounded-2xl bg-card px-4 py-3"
    >
      <div className="text-[15px] leading-relaxed text-foreground">
        <ChatMarkdown>{block.text}</ChatMarkdown>
      </div>
      {answered ? (
        <div
          className={`mt-2 text-[13.5px] font-medium ${outcome === "shared" || outcome === "typed" ? "text-success" : "text-muted-foreground"}`}
        >
          {outcome === "shared" || outcome === "typed" ? (
            t`Location shared`
          ) : outcome === "declined" ? (
            t`Not shared`
          ) : (
            // Retired by a new message before anyone answered the card.
            <Trans>No longer active</Trans>
          )}
        </div>
      ) : !canAnswer ? (
        <div className="mt-2 text-[13.5px] font-medium text-muted-foreground">
          <Trans>No longer active</Trans>
        </div>
      ) : isRunUser && block.location ? (
        <div className="mt-3 flex flex-col gap-2">
          {canShareDevicePosition() ? (
            <Button
              type="button"
              className="h-auto min-h-9 w-fit whitespace-normal px-4 py-2"
              disabled={pending !== null}
              onClick={shareOnce}
            >
              <MapPin aria-hidden className="size-4" />
              {pending === "position" ? <Trans>Locating…</Trans> : <Trans>Share location</Trans>}
            </Button>
          ) : null}
          <form
            className="flex min-w-0 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const typed = place.trim();
              if (!typed) return;
              void run("place", () => send({ kind: "place", place: typed }, "typed"));
            }}
          >
            <Input
              className="min-w-0 flex-1"
              aria-label={t`Place`}
              placeholder={t`Type a place`}
              maxLength={LOCATION_PLACE_MAX_LENGTH}
              disabled={pending !== null}
              value={place}
              onChange={(event) => setPlace(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={!place.trim() || pending !== null}>
              {pending === "place" ? <Trans>Sending…</Trans> : <Trans>Send</Trans>}
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-h-9 w-fit px-2 py-1.5 text-muted-foreground"
            disabled={pending !== null}
            onClick={() => void run("declined", () => send({ kind: "declined" }, "declined"))}
          >
            <Trans>Don't share</Trans>
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </BuiCard>
  );
}
