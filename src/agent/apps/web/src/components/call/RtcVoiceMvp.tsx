import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { appPath } from "../../lib/app-path";
import { withSpaceHeaders } from "../../lib/rpc";
import { RtcVoiceTrial, type VoiceTrialEvent } from "../../lib/rtc-voice-mvp";

/** Local opt-in qualification panel. The usual call interface remains unchanged. */
export function RtcVoiceMvp({
  botId,
  botName,
  spaceId,
  taskThreadId,
  ordinaryCallActive,
}: {
  botId: string;
  botName: string;
  spaceId: string | null;
  taskThreadId?: string;
  ordinaryCallActive: boolean;
}) {
  const { t } = useLingui();
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  const [stats, setStats] = useState<VoiceTrialEvent>();
  const client = useRef<RtcVoiceTrial | undefined>(undefined);
  const starting = useRef(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("voice-mvp") !== "1") return;
    const controller = new AbortController();
    void fetch(appPath("/api/voice/rtc/capability"), {
      credentials: "include",
      headers: withSpaceHeaders(undefined, spaceId),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) setEnabled((await response.json()).enabled === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [spaceId]);
  useEffect(
    () => () => {
      void client.current?.stop();
    },
    [],
  );
  useEffect(() => {
    if (ordinaryCallActive) void client.current?.stop();
  }, [ordinaryCallActive]);
  if (!enabled) return null;
  const active = phase !== "idle" && phase !== "closed";
  const start = async () => {
    if (active || ordinaryCallActive || starting.current) return;
    starting.current = true;
    setError("");
    setStats(undefined);
    setMuted(false);
    setNeedsPlayback(false);
    const trial = new RtcVoiceTrial(
      { botId, ...(taskThreadId ? { taskThreadId } : {}) },
      spaceId,
      (event) => {
        if (client.current !== trial) return;
        if (event.type === "state" && event.phase) setPhase(event.phase);
        if (event.type === "closed") {
          starting.current = false;
          setPhase("closed");
        }
        if (event.type === "stats") setStats(event);
        if (event.error) setError(event.error);
        if (event.type === "needs-playback") setNeedsPlayback(true);
      },
    );
    client.current = trial;
    try {
      await trial.start();
    } catch (cause) {
      starting.current = false;
      setError(cause instanceof Error ? cause.message : t`Voice trial failed.`);
      setPhase("closed");
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(client.current?.diagnostic(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "mycellios-voice-trial.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const label: Record<string, string> = {
    idle: t`Ready`,
    connecting: t`Connecting…`,
    listening: t`Listening`,
    transcribing: t`Transcribing…`,
    thinking: t`Thinking…`,
    speaking: t`Speaking`,
    error: t`Interrupted`,
    closed: t`Call ended`,
  };
  return (
    <section
      aria-label={t`Experimental WebRTC voice`}
      className="border-b border-border px-4 py-3 text-sm"
      data-testid="rtc-voice-mvp"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {t`Voice trial`} · {botName}
        </span>
        <span role="status" className="text-muted-foreground">
          {label[phase] ?? phase}
        </span>
        {active ? (
          <>
            <Button
              variant="outline"
              onClick={() => {
                const value = !muted;
                setMuted(value);
                client.current?.setMuted(value);
              }}
              aria-pressed={muted}
            >
              {muted ? t`Unmute` : t`Mute`}
            </Button>
            <Button
              variant="outline"
              onClick={() => void client.current?.stop()}
            >{t`End call`}</Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={ordinaryCallActive}
            onClick={() => void start()}
          >{t`Start voice trial`}</Button>
        )}
        {needsPlayback && active && (
          <Button
            variant="outline"
            onClick={() => {
              void client.current?.resumeAudio();
              setNeedsPlayback(false);
            }}
          >{t`Enable audio`}</Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
      <details className="mt-2 text-muted-foreground">
        <summary className="cursor-pointer">{t`Lock-screen test`}</summary>
        <p className="my-2">{t`Start the test, lock your phone for one minute, and speak to the Mico. After unlocking, refresh the diagnostics. Hidden-page events alone do not prove lock-screen support.`}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!active}
            onClick={() => client.current?.checkLock()}
          >{t`Mark test start`}</Button>
          <Button
            variant="outline"
            disabled={!active}
            onClick={() => client.current?.stats()}
          >{t`Refresh diagnostics`}</Button>
          <Button
            variant="outline"
            disabled={!client.current}
            onClick={download}
          >{t`Download diagnostics`}</Button>
        </div>
        {stats && (
          <p className="mt-2">
            {t`Audio packets received`}: {Number(stats.receivedPackets ?? 0)} ·{" "}
            {t`Audio packets sent`}: {Number(stats.sentPackets ?? 0)} · {t`Turns`}:{" "}
            {Number(stats.turns ?? 0)}
          </p>
        )}
      </details>
    </section>
  );
}
