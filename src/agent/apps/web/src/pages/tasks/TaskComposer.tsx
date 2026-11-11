import { getGeneralPreferences } from "../../lib/general-preferences";
import { botColors } from "@rakazo/ui-tokens";
import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Textarea,
  BotAvatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import { ArrowUp, Check, ChevronDown, LoaderCircle, Mic, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type DictationSnapshot, dictation } from "../../lib/dictation";

export function TaskAgentSelect({
  bots,
  botId,
  onChange,
  disabled,
}: {
  bots: Bot[];
  botId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const bot = bots.find((item) => item.id === botId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="rk-task-agent"
        aria-label={t`Assign task to Mico`}
      >
        <BotAvatar identity={bot?.id ?? "task"} color={bot?.color ?? botColors[3]} size={18} />
        <span className="truncate">{bot?.name ?? t`Choose a Mico`}</span>
        <ChevronDown size={11} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 overflow-y-auto" align="start">
        {bots.map((item) => (
          <DropdownMenuItem key={item.id} onClick={() => onChange(item.id)}>
            <BotAvatar identity={item.id} color={item.color} size={18} />
            <span className="flex-1">{item.name}</span>
            {item.id === botId ? <Check size={14} /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function TaskComposer({
  value,
  onChange,
  onSubmit,
  bots,
  botId,
  onAgent,
  disabled,
  transcribe,
  autoFocus,
  onFiles,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text?: string) => void;
  bots: Bot[];
  botId: string;
  onAgent: (id: string) => void;
  disabled: boolean;
  transcribe?: boolean;
  autoFocus?: boolean;
  onFiles?: (files: File[]) => void;
}) {
  const { t } = useLingui();
  const editor = useRef<HTMLTextAreaElement>(null);
  const [model, setModel] = useState<{
    ready: boolean;
    preparing: boolean;
    downloaded: number;
    total: number;
    error?: string;
  } | null>(null);
  const alive = useRef(true),
    preparing = useRef(false);
  useEffect(() => {
    if (!model?.preparing) return;
    const native = window.rakazoDesktop?.localVoice;
    if (!native) return;
    const timer = setInterval(
      () =>
        void native
          .status()
          .then((status) => {
            if (alive.current) setModel(status.ready ? null : status);
          })
          .catch(() => {}),
      1000,
    );
    return () => clearInterval(timer);
  }, [model?.preparing]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [speech, setSpeech] = useState<DictationSnapshot>({ status: "idle", transcript: "" }),
    [recording, setRecording] = useState(false);
  const owns = useRef(false),
    sendOnFinish = useRef(false),
    latest = useRef({ value, onChange, onSubmit });
  latest.current = { value, onChange, onSubmit };
  useEffect(() => {
    const field = editor.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${Math.min(180, Math.max(44, field.scrollHeight))}px`;
    }
  }, [value]);
  useEffect(() => {
    if (autoFocus) editor.current?.focus();
  }, [autoFocus]);
  useEffect(
    () =>
      dictation.subscribe((snapshot) => {
        if (!owns.current) return;
        setSpeech(snapshot);
        if (snapshot.status === "idle") {
          owns.current = false;
          setRecording(false);
        }
      }),
    [],
  );
  useEffect(
    () => () => {
      if (owns.current) dictation.stop("cancel");
    },
    [],
  );
  function stop(cancel: boolean) {
    if (cancel) {
      sendOnFinish.current = false;
      owns.current = false;
      setRecording(false);
      dictation.stop("cancel");
    } else dictation.submitHold();
  }
  async function listen() {
    if (disabled || recording) return;
    const native = window.rakazoDesktop?.localVoice;
    if (native && !getGeneralPreferences().networkTranscriptionAccount) {
      try {
        const fullStatus = await native.status();
        const status = fullStatus.models?.asr ?? fullStatus;
        if (!alive.current) return;
        if (!status.ready) {
          setModel(status);
          return;
        }
      } catch {
        if (alive.current)
          setSpeech({
            status: "idle",
            transcript: "",
            error: t`Could not prepare local voice. Try again.`,
          });
        return;
      }
    }
    if (!alive.current) return;
    owns.current = true;
    setRecording(true);
    setSpeech({ status: "listening", transcript: "" });
    sendOnFinish.current = false;
    void dictation.listen({
      botId,
      mode: "hold",
      transcribe,
      onFinal: (text) => {
        const next = [latest.current.value, text].filter(Boolean).join(" ");
        latest.current.onChange(next);
        if (sendOnFinish.current) latest.current.onSubmit(next);
        owns.current = false;
        setRecording(false);
      },
    });
  }
  async function prepareVoice() {
    const native = window.rakazoDesktop?.localVoice;
    if (!native || preparing.current) return;
    preparing.current = true;
    setModel({ ready: false, preparing: true, downloaded: 0, total: 0 });
    const timer = setInterval(
      () =>
        void native
          .status()
          .then((status) => {
            if (alive.current) setModel(status.models?.asr ?? status);
          })
          .catch(() => {}),
      1000,
    );
    try {
      if (native.prepareModel) await native.prepareModel("asr");
      else await native.prepare();
      if (alive.current) {
        setModel(null);
        await listen();
      }
    } catch {
      if (alive.current)
        setModel({
          ready: false,
          preparing: false,
          downloaded: 0,
          total: 0,
          error: t`Could not prepare local voice. Try again.`,
        });
    } finally {
      preparing.current = false;
      clearInterval(timer);
    }
  }
  return (
    <form
      className="rk-task-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        if (recording) {
          sendOnFinish.current = true;
          stop(false);
        } else onSubmit();
      }}
      onDragOver={(event) => {
        if (!disabled && onFiles && event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!disabled && onFiles && event.dataTransfer.files.length) {
          event.preventDefault();
          onFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      {recording ? (
        <div className="rk-task-recording" role="status">
          <span className="rk-task-recording-dot" />
          <span>
            {speech.status === "transcribing"
              ? t`Transcribing…`
              : speech.transcript || t`Listening…`}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Cancel recording`}
            onClick={() => stop(true)}
          >
            <X size={15} />
          </Button>
        </div>
      ) : (
        <Textarea
          disabled={disabled}
          ref={editor}
          aria-label={t`What would you like done?`}
          placeholder={t`What would you like done?`}
          value={value}
          maxLength={16000}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled && value.trim()) onSubmit();
            }
          }}
          onPaste={(event) => {
            if (!disabled && onFiles && event.clipboardData.files.length) {
              event.preventDefault();
              onFiles(Array.from(event.clipboardData.files));
            }
          }}
        />
      )}
      <div className="rk-task-composer-bottom">
        <TaskAgentSelect
          bots={bots}
          botId={botId}
          onChange={onAgent}
          disabled={disabled || recording}
        />
        <div className="ms-auto flex items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            className="rk-task-mic"
            aria-label={recording ? t`Finish dictation` : t`Dictate task`}
            disabled={disabled || speech.status === "transcribing" || Boolean(model?.preparing)}
            onClick={() => (recording ? stop(false) : listen())}
          >
            {speech.status === "transcribing" ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Mic size={15} />
            )}
          </Button>
          <Button
            type="submit"
            size="icon-sm"
            className="rk-task-send"
            aria-label={t`Send task`}
            disabled={disabled || (!recording && !value.trim())}
          >
            <ArrowUp size={16} />
          </Button>
        </div>
      </div>
      {speech.error ? (
        <p className="px-1 pt-1 text-xs text-destructive" role="alert">
          {speech.error}
        </p>
      ) : null}
      {model && !model.ready ? (
        <div
          className="flex flex-wrap items-center gap-2 px-1 pt-2 text-xs text-muted-foreground"
          role="status"
        >
          <span>
            {model.preparing
              ? t`Preparing local voice…`
              : model.error || t`Prepare voice on this device without an API key.`}
          </span>
          {model.preparing ? (
            <span>
              {model.total > 0 ? `${Math.round((model.downloaded / model.total) * 100)} %` : ""}
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void prepareVoice()}
            >{t`Prepare local voice`}</Button>
          )}
        </div>
      ) : null}
    </form>
  );
}
