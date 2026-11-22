import { useLingui } from "@lingui/react/macro";
import { Button, Disclosure, Textarea } from "@mycellios/ui-web";
import { useEffect, useRef, useState } from "react";
import { draftOnboardingTeam, type OnboardingTeamMember } from "./create-onboarding-team";
import {
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
import { BackLink, ChoiceList, ChoiceRow, OnboardingHeading } from "./onboarding-ui";

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
  onSingleMico,
}: {
  onCreate: (members: OnboardingTeamMember[]) => Promise<void>;
  onUseProvider: (members: OnboardingTeamMember[] | null) => void;
  onSingleMico: () => Promise<void>;
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

  async function singleMico() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSingleMico();
    } catch {
      setError("create");
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
  const questions = phase.kind === "question" ? questionsFor() : [];
  const question = questions[phase.kind === "question" ? phase.index : 0];

  const optionRows = (
    ids: readonly string[],
    label: (id: string) => string,
    selected: string | null,
    pick: (id: string) => void,
  ) => (
    <ChoiceList className="mt-3">
      {ids.map((id) => (
        <ChoiceRow key={id} title={label(id)} pressed={selected === id} onClick={() => pick(id)} />
      ))}
    </ChoiceList>
  );

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
          <OnboardingHeading title={copy.heading} description={copy.intro} />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={copy.placeholder}
            aria-label={copy.heading}
            rows={4}
            maxLength={2000}
            className="mt-8 rounded-xl bg-card px-4 py-3"
            disabled={busy}
          />
          <Button type="submit" size="lg" className="mt-3 w-full" disabled={busy || !description.trim()}>
            {t`Continue`}
          </Button>
          <p className="mt-3 text-center text-sm text-muted-foreground">{copy.setupCost}</p>
          <Disclosure summary={copy.gallery} className="mt-8" contentClassName="mt-3">
            <ChoiceList>
              {TEAM_SECTORS.map((id) => {
                const item = copy.sectors[id];
                const roster = membersFor({ description: description.trim(), sector: id, audience: "me", start: "drafts" });
                return (
                  <ChoiceRow
                    key={id}
                    title={item.name}
                    detail={
                      <>
                        {item.summary}
                        <span className="mt-1 block text-foreground/80">{roster.map((member) => member.name).join(", ")}</span>
                      </>
                    }
                    aria-label={`${copy.putToWork}: ${item.name}`}
                    disabled={busy}
                    onClick={() => void create(roster)}
                  />
                );
              })}
            </ChoiceList>
          </Disclosure>
        </form>
      ) : null}
      {phase.kind === "question" && question ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const text = phase.description;
            if (question === "sector" && !sector) return;
            if (question === "audience" && !audience) return;
            if (question === "start" && !start) return;
            const nextIndex = phase.index + 1;
            if (nextIndex < questions.length) {
              setPhase({ kind: "question", index: nextIndex, description: text });
              return;
            }
            propose({
              description: text,
              sector: sector ?? "operations",
              audience: audience ?? "me",
              start: start ?? "drafts",
            });
          }}
        >
          <BackLink
            onClick={() => {
              setError(null);
              if (phase.index === 0) setPhase({ kind: "describe" });
              else setPhase({ kind: "question", index: phase.index - 1, description: phase.description });
            }}
          >
            {t`Back`}
          </BackLink>
          <div className="mt-4">
            <OnboardingHeading title={copy.questionsIntro} description={<span className="break-words">{phase.description}</span>} />
          </div>
          <fieldset className="mt-8">
            <legend className="text-sm font-medium text-foreground">
              {question === "sector" ? copy.closest : question === "audience" ? copy.who : copy.first}
            </legend>
            {question === "sector"
              ? optionRows(TEAM_SECTORS, (id) => copy.sectors[id as TeamSector].name, sector, (id) => setSector(id as TeamSector))
              : null}
            {question === "audience"
              ? optionRows(TEAM_AUDIENCES, (id) => copy.audiences[id as TeamAudience], audience, (id) => setAudience(id as TeamAudience))
              : null}
            {question === "start"
              ? optionRows(TEAM_STARTS, (id) => copy.starts[id as TeamStart], start, (id) => setStart(id as TeamStart))
              : null}
          </fieldset>
          <Button
            type="submit"
            size="lg"
            className="mt-6 w-full"
            disabled={
              (question === "sector" && !sector) ||
              (question === "audience" && !audience) ||
              (question === "start" && !start)
            }
          >
            {t`Continue`}
          </Button>
        </form>
      ) : null}
      {phase.kind === "proposal" && proposal ? (
        <div>
          <BackLink
            disabled={busy}
            onClick={() => {
              setError(null);
              setPhase({ kind: "question", index: 0, description: phase.description });
            }}
          >
            {t`Back`}
          </BackLink>
          <div className="mt-4">
            <OnboardingHeading
              title={copy.proposal}
              description={`${copy.sectors[phase.sector].summary} ${copy.credits}`}
            />
          </div>
          <ul className="mt-8 w-full overflow-hidden rounded-xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">
            {proposal.map((member) => (
              <li key={member.id} className="px-4 py-3">
                <p className="font-semibold text-foreground">{member.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{member.title}</p>
              </li>
            ))}
          </ul>
          <Button type="button" size="lg" className="mt-6 w-full" disabled={busy} onClick={() => void create(proposal)}>
            {busy ? copy.creating : copy.putToWork}
          </Button>
          <p className="mt-3 text-center text-sm text-muted-foreground">{copy.setupCost}</p>
          <div className="mt-4 flex justify-center">
            <Button type="button" variant="link" className="h-auto px-0 text-muted-foreground" disabled={busy} onClick={() => onUseProvider(proposal)}>
              {copy.ownProvider}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-xl border border-destructive/30 px-4 py-3" role="alert" ref={alertRef}>
          <p className="text-sm text-destructive">
            {error === "credits" ? copy.creditsUnavailable : copy.createFailed}
          </p>
          {error === "credits" ? (
            <Button type="button" variant="outline" className="mt-3" onClick={() => onUseProvider(attempt ?? proposal)}>
              {copy.ownProvider}
            </Button>
          ) : null}
        </div>
      ) : null}
      {phase.kind === "describe" ? (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Button type="button" variant="link" className="h-auto px-0 text-muted-foreground" disabled={busy} onClick={() => void singleMico()}>
            {copy.singleMico}
          </Button>
          <span aria-hidden="true">·</span>
          <Button type="button" variant="link" className="h-auto px-0 text-muted-foreground" disabled={busy} onClick={() => onUseProvider(null)}>
            {copy.ownProvider}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
