import { useLingui } from "@lingui/react/macro";
import { Button, Textarea } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { draftOnboardingTeam, type OnboardingTeamMember } from "./create-onboarding-team";
import {
  inferSector,
  questionsFor,
  TEAM_AUDIENCES,
  TEAM_SECTORS,
  TEAM_STARTS,
  type TeamAudience,
  TeamCreditsError,
  type TeamSector,
  type TeamStart,
} from "./team-catalog";
import { useTeamCopy } from "./team-copy";

type Phase =
  | { kind: "describe" }
  | { kind: "question"; index: number; description: string }
  | {
      kind: "proposal";
      description: string;
      sector: TeamSector;
      audience: TeamAudience;
      start: TeamStart;
    };

export function TeamBuilder({
  onCreate,
  onUseProvider,
}: {
  onCreate: (members: OnboardingTeamMember[]) => Promise<void>;
  onUseProvider: (members: OnboardingTeamMember[] | null) => void;
}) {
  const { t } = useLingui();
  const copy = useTeamCopy();
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "describe" });
  const [audience, setAudience] = useState<TeamAudience | null>(null);
  const [start, setStart] = useState<TeamStart | null>(null);
  const [sector, setSector] = useState<TeamSector | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"credits" | "create" | null>(null);
  const [attempt, setAttempt] = useState<OnboardingTeamMember[] | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alertRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);

  function membersFor(next: {
    description: string;
    sector: TeamSector;
    audience: TeamAudience;
    start: TeamStart;
  }): OnboardingTeamMember[] {
    return draftOnboardingTeam(next.description, next, {
      member: (id) => copy.members[id],
      audience: copy.audiences[next.audience],
      start: copy.starts[next.start],
    });
  }

  async function create(members: OnboardingTeamMember[]) {
    if (busy) return;
    setAttempt(members);
    setBusy(true);
    setError(null);
    try {
      await onCreate(members);
    } catch (cause) {
      setError(cause instanceof TeamCreditsError ? "credits" : "create");
      setBusy(false);
    }
  }

  function propose(next: {
    description: string;
    sector: TeamSector;
    audience: TeamAudience;
    start: TeamStart;
  }) {
    setSector(next.sector);
    setAudience(next.audience);
    setStart(next.start);
    setError(null);
    setPhase({ kind: "proposal", ...next });
  }

  const proposal = phase.kind === "proposal" ? membersFor(phase) : null;
  const questions = phase.kind === "question" ? questionsFor(phase.description) : [];
  const question = questions[phase.kind === "question" ? phase.index : 0];

  return (
    <div data-testid="onboarding-team">
      {phase.kind === "describe" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const text = description.trim();
            if (!text || busy) return;
            setAudience(null);
            setStart(null);
            setSector(null);
            setError(null);
            setPhase({ kind: "question", index: 0, description: text });
          }}
        >
          <h1 className="text-[32px] font-medium text-foreground">{copy.heading}</h1>
          <p className="mt-4 text-muted-foreground">{copy.intro}</p>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={copy.placeholder}
            aria-label={copy.heading}
            rows={4}
            className="mt-4"
            disabled={busy}
          />
          <Button type="submit" className="mt-4 w-full" disabled={busy || !description.trim()}>
            {t`Continue`}
          </Button>
          <h2 className="mt-8 text-sm font-medium text-foreground">{copy.gallery}</h2>
          <div className="mt-3 grid gap-3">
            {TEAM_SECTORS.map((id) => {
              const item = copy.sectors[id];
              const roster = membersFor({
                description: description.trim(),
                sector: id,
                audience: "me",
                start: "drafts",
              });
              return (
                <div key={id} className="rounded-md border border-border p-3">
                  <p className="font-medium text-foreground">{item.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
                  <p className="mt-2 text-sm text-foreground">
                    {roster.map((member) => member.name).join(", ")}
                  </p>
                  <Button
                    type="button"
                    className="mt-3"
                    aria-label={`${copy.putToWork}: ${item.name}`}
                    disabled={busy}
                    onClick={() =>
                      void create(
                        membersFor({
                          description: description.trim(),
                          sector: id,
                          audience: "me",
                          start: "drafts",
                        }),
                      )
                    }
                  >
                    {busy ? copy.creating : copy.putToWork}
                  </Button>
                </div>
              );
            })}
          </div>
        </form>
      ) : null}
      {phase.kind === "question" && question ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const text = phase.description;
            const pickedSector = question === "sector" ? sector : null;
            const pickedAudience = question === "audience" ? audience : null;
            const pickedStart = question === "start" ? start : null;
            if (question === "sector" && !pickedSector) return;
            if (question === "audience" && !pickedAudience) return;
            if (question === "start" && !pickedStart) return;
            const nextIndex = phase.index + 1;
            if (nextIndex < questions.length) {
              setPhase({ kind: "question", index: nextIndex, description: text });
              return;
            }
            propose({
              description: text,
              sector: (questions.includes("sector") ? sector : inferSector(text)) ?? "operations",
              audience: audience ?? "me",
              start: start ?? "drafts",
            });
          }}
        >
          <h1 className="text-[32px] font-medium text-foreground">{copy.questionsIntro}</h1>
          <p className="mt-4 text-muted-foreground">{phase.description}</p>
          <fieldset className="mt-6 grid gap-2">
            <legend className="text-sm font-medium text-foreground">
              {question === "sector"
                ? copy.closest
                : question === "audience"
                  ? copy.who
                  : copy.first}
            </legend>
            {question === "sector"
              ? TEAM_SECTORS.map((id) => (
                  <Button
                    key={id}
                    type="button"
                    variant={sector === id ? "default" : "outline"}
                    aria-pressed={sector === id}
                    onClick={() => setSector(id)}
                  >
                    {copy.sectors[id].name}
                  </Button>
                ))
              : null}
            {question === "audience"
              ? TEAM_AUDIENCES.map((id) => (
                  <Button
                    key={id}
                    type="button"
                    variant={audience === id ? "default" : "outline"}
                    aria-pressed={audience === id}
                    onClick={() => setAudience(id)}
                  >
                    {copy.audiences[id]}
                  </Button>
                ))
              : null}
            {question === "start"
              ? TEAM_STARTS.map((id) => (
                  <Button
                    key={id}
                    type="button"
                    variant={start === id ? "default" : "outline"}
                    aria-pressed={start === id}
                    onClick={() => setStart(id)}
                  >
                    {copy.starts[id]}
                  </Button>
                ))
              : null}
          </fieldset>
          <Button
            type="submit"
            className="mt-6 w-full"
            disabled={
              (question === "sector" && !sector) ||
              (question === "audience" && !audience) ||
              (question === "start" && !start)
            }
          >
            {t`Continue`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="mt-3"
            onClick={() => {
              setError(null);
              if (phase.index === 0) setPhase({ kind: "describe" });
              else
                setPhase({
                  kind: "question",
                  index: phase.index - 1,
                  description: phase.description,
                });
            }}
          >
            {t`Back`}
          </Button>
        </form>
      ) : null}
      {phase.kind === "proposal" && proposal ? (
        <div>
          <h1 className="text-[32px] font-medium text-foreground">{copy.proposal}</h1>
          <p className="mt-4 text-muted-foreground">
            {copy.sectors[phase.sector].summary} {copy.credits}
          </p>
          <ul className="mt-4 grid gap-3">
            {proposal.map((member) => (
              <li key={member.id} className="rounded-md border border-border p-3">
                <p className="font-medium text-foreground">{member.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{member.title}</p>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            className="mt-6 w-full"
            disabled={busy}
            onClick={() => void create(proposal)}
          >
            {busy ? copy.creating : copy.putToWork}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full"
            disabled={busy}
            onClick={() => onUseProvider(proposal)}
          >
            {copy.ownProvider}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="mt-3"
            disabled={busy}
            onClick={() => {
              setError(null);
              setPhase({ kind: "question", index: 0, description: phase.description });
            }}
          >
            {t`Back`}
          </Button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4" role="alert" ref={alertRef}>
          <p className="text-sm text-destructive">
            {error === "credits" ? copy.creditsUnavailable : copy.createFailed}
          </p>
          {error === "credits" ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => onUseProvider(attempt ?? proposal)}
            >
              {copy.ownProvider}
            </Button>
          ) : null}
        </div>
      ) : null}
      {phase.kind === "describe" ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-6"
          disabled={busy}
          onClick={() => onUseProvider(null)}
        >
          {copy.ownProvider}
        </Button>
      ) : null}
    </div>
  );
}
