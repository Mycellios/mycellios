import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { AgentQuestion } from "@rakazo/contracts";
import { Button, Input } from "@rakazo/ui-web";
import { MessageCircleQuestion, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AskBlock } from "./AskCard";
import { QuestionOption } from "./QuestionOption";
import { errorText } from "../lib/user-error";

type Draft = { selected: string[]; text: string };
const EMPTY: Draft = { selected: [], text: "" };
const SKIPPED = "[Question skipped; no answer or authorization was provided.]";

/** One question at a time; only the final submission resumes the existing paused run. */
export function QuestionnaireCard({ block, canAnswer, onAnswer }: {
  block: AskBlock; canAnswer: boolean; onAnswer: (text: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const questions: AgentQuestion[] = block.questions ?? [{ id: "question-1", question: block.text,
    options: block.actions?.map(action => ({ id: action.id, label: action.label })) ?? [] }];
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [accepted, setAccepted] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = questions[Math.min(page, questions.length - 1)]!;
  const draft = drafts[current.id] ?? EMPTY;
  const answered = block.status === "answered" || accepted !== undefined;
  const disabled = !canAnswer || pending || answered;
  function clearAdvance() { clearTimeout(timer.current); }
  useEffect(() => () => clearAdvance(), []);
  // A stale card or a change of context must never send a scheduled choice.
  useEffect(() => { if (disabled) clearAdvance(); }, [disabled]);
  useEffect(() => { if (page > 0) heading.current?.focus({ preventScroll: true }); }, [page]);

  function values(question: AgentQuestion, entry = drafts[question.id] ?? EMPTY) {
    const picked = question.options.filter(option => entry.selected.includes(option.id)).map(option => option.label);
    return question.multiSelect ? [...picked, ...(entry.text.trim() ? [entry.text.trim()] : [])]
      : entry.text.trim() ? [entry.text.trim()] : picked.slice(0, 1);
  }
  async function submit(next = drafts) {
    if (lock.current || disabled) return;
    clearAdvance(); lock.current = true; setPending(true); setError(undefined);
    const first = next[questions[0]!.id] ?? EMPTY;
    const answer = !block.questions && questions.length === 1
      ? first.text.trim() || first.selected[0] || SKIPPED
      : questions.map(question => `${question.question}\n${values(question, next[question.id] ?? EMPTY).join("; ") || SKIPPED}`).join("\n\n");
    try { await onAnswer(answer); setAccepted(answer); }
    catch (cause) { setError(errorText(cause, t`Could not submit this answer`)); }
    finally { lock.current = false; setPending(false); }
  }
  function advance(next = drafts) {
    clearAdvance();
    if (page < questions.length - 1) setPage(page + 1);
    else void submit(next);
  }
  function select(id: string) {
    if (disabled) return;
    clearAdvance();
    const selected = current.multiSelect
      ? draft.selected.includes(id) ? draft.selected.filter(value => value !== id) : [...draft.selected, id]
      : [id];
    const next = { ...drafts, [current.id]: { selected, text: current.multiSelect ? draft.text : "" } };
    setDrafts(next);
    // Brief selection feedback, matching the source questionnaire's 180 ms hold.
    if (!current.multiSelect) timer.current = setTimeout(() => advance(next), 180);
  }
  function skip(all = false) {
    if (disabled) return;
    const next = all ? {} : { ...drafts, [current.id]: EMPTY };
    setDrafts(next); all ? void submit(next) : advance(next);
  }

  if (answered) {
    const answer = block.status === "answered" ? block.answer : accepted;
    const selected = block.actions?.find(action => action.id === answer)?.label;
    return <div data-testid="answered-question-card" className="w-full min-w-0 max-w-md rounded-2xl bg-card px-4 py-3">
      <p className="whitespace-pre-wrap break-words text-sm leading-5">{answer === SKIPPED ? t`Skipped` : selected ?? answer ?? t`Answered`}</p>
      <details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer"><Trans>View question</Trans></summary>
        {questions.map(question => <div key={question.id} className="mt-2"><ChatMarkdown>{question.question}</ChatMarkdown></div>)}
      </details>
    </div>;
  }
  return <div className="w-full min-w-0 max-w-md">
    <form data-testid="question-ask-card" aria-busy={pending} className="relative rounded-2xl bg-card px-4 py-3"
      onSubmit={event => { event.preventDefault(); if (values(current).length) advance(); }}
      onKeyDown={event => {
        if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
        const index = event.key.toUpperCase().charCodeAt(0) - 65;
        if (event.key.length === 1 && index >= 0 && index < current.options.length) { event.preventDefault(); select(current.options[index]!.id); }
      }}>
      <Button type="button" variant="ghost" size="icon-sm" className="absolute end-2 top-2 size-6 text-muted-foreground"
        disabled={disabled} aria-label={t`Skip all questions`} onClick={() => skip(true)}><X size={13} /></Button>
      {questions.length > 1 ? <div className="mb-3 flex items-center gap-2 pe-7 text-xs text-muted-foreground">
        <Button type="button" variant="ghost" size="icon-sm" className="size-6" disabled={page === 0 || disabled} aria-label={t`Previous question`} onClick={() => { clearAdvance(); setPage(page - 1); }}><ChevronLeft size={14} /></Button>
        <span aria-live="polite">{page + 1} / {questions.length}</span>
        <Button type="button" variant="ghost" size="icon-sm" className="size-6" disabled={page === questions.length - 1 || disabled} aria-label={t`Next question`} onClick={() => { clearAdvance(); setPage(page + 1); }}><ChevronRight size={14} /></Button>
      </div> : null}
      <div ref={heading} tabIndex={-1} className="pe-7 text-[14px] font-semibold leading-5 outline-none"><ChatMarkdown>{current.question}</ChatMarkdown></div>
      {block.detail ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{block.detail}</p> : null}
      {current.multiSelect ? <p className="mt-1 text-xs text-muted-foreground"><Trans>Choose all that apply</Trans></p> : null}
      <fieldset disabled={disabled} className="mt-2 min-w-0 space-y-0.5 border-0 p-0">
        <legend className="sr-only">{current.question}</legend>
        {current.options.map((option, index) => <QuestionOption key={option.id} letter={String.fromCharCode(65 + index)} accessibleLabel={option.label}
          selected={draft.selected.includes(option.id)} disabled={disabled} onClick={() => select(option.id)}>
          <span className="block text-[14px] leading-5">{option.label}</span>
          {option.description ? <span className="block text-xs leading-4 text-muted-foreground">{option.description}</span> : null}
        </QuestionOption>)}
        <label className="flex min-h-11 items-center gap-3 rounded-lg px-1 py-2">
          <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-background/50 text-xs font-medium text-muted-foreground">{String.fromCharCode(65 + current.options.length)}</span>
          <Input ref={input} aria-label={t`Your answer`} placeholder={t`Something else`} maxLength={1600} disabled={disabled}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm shadow-none"
            value={draft.text} onChange={event => { clearAdvance(); setDrafts({ ...drafts, [current.id]: { selected: current.multiSelect ? draft.selected : [], text: event.target.value } }); }} />
        </label>
      </fieldset>
      {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" className="h-9 rounded-md px-3.5 text-sm font-normal" disabled={disabled} onClick={() => skip()}><Trans>Skip</Trans></Button>
        <Button type="submit" className="h-9 rounded-md px-3.5 text-sm font-normal" disabled={disabled || !values(current).length}>
          {pending ? t`Sending…` : page === questions.length - 1 ? t`Done` : t`Next`}
        </Button>
      </div>
      {!canAnswer ? <p className="mt-2 text-xs text-muted-foreground"><Trans>No longer active</Trans></p> : null}
    </form>
    {canAnswer ? <p className="mt-3 flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground"><MessageCircleQuestion className="size-3" aria-hidden /><Trans>Waiting for your response</Trans></p> : null}
  </div>;
}
