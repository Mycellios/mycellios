import { useLingui } from "@lingui/react/macro";
import type { TeamAudience, TeamMemberId, TeamSector, TeamStart } from "./team-catalog";

export function useTeamCopy() {
  const { t } = useLingui();
  const sectors: Record<TeamSector, { name: string; summary: string }> = {
    sales: { name: t`Sales`, summary: t`Find leads, write outreach, and follow up.` },
    seo: { name: t`SEO`, summary: t`Research queries, edit pages, and check technical issues.` },
    support: {
      name: t`Support`,
      summary: t`Sort the inbox, draft replies, and keep what the team learned.`,
    },
    research: {
      name: t`Research`,
      summary: t`Gather sources, check them, and write a short brief.`,
    },
    marketing: {
      name: t`Marketing`,
      summary: t`Plan a campaign, write the words, and read the results.`,
    },
    operations: {
      name: t`Operations`,
      summary: t`Keep work in order, write the steps, and track what is open.`,
    },
  };
  const members: Record<TeamMemberId, { name: string; line: string }> = {
    "sales-research": {
      name: t`Lead Researcher`,
      line: t`Finds the accounts and facts a message should use.`,
    },
    "sales-outreach": {
      name: t`Outreach Writer`,
      line: t`Drafts the first message for you to review.`,
    },
    "sales-followup": { name: t`Follow-up`, line: t`Tracks replies and the next step.` },
    "seo-research": {
      name: t`Search Researcher`,
      line: t`Maps the questions people ask and the sources to use.`,
    },
    "seo-editor": {
      name: t`Content Editor`,
      line: t`Drafts and edits pages from those questions.`,
    },
    "seo-technical": {
      name: t`Technical SEO`,
      line: t`Checks issues that keep pages from being found.`,
    },
    "support-triage": {
      name: t`Inbox Triage`,
      line: t`Sorts what needs a reply and what can wait.`,
    },
    "support-reply": { name: t`Reply Writer`, line: t`Drafts a clear answer for you to send.` },
    "support-knowledge": {
      name: t`Knowledge Keeper`,
      line: t`Records the answer so the next reply can reuse it.`,
    },
    "research-gather": { name: t`Researcher`, line: t`Gathers the sources for the question.` },
    "research-check": {
      name: t`Source Checker`,
      line: t`Separates what is known from what is still a guess.`,
    },
    "research-brief": { name: t`Brief Writer`, line: t`Turns that into a short brief.` },
    "marketing-plan": { name: t`Campaign Planner`, line: t`Turns a goal into a small plan.` },
    "marketing-copy": { name: t`Copywriter`, line: t`Drafts the words for you to review.` },
    "marketing-analyst": { name: t`Analyst`, line: t`Reads the results and says what changed.` },
    "operations-coordinator": { name: t`Coordinator`, line: t`Keeps the requested work in order.` },
    "operations-process": {
      name: t`Process Writer`,
      line: t`Writes the steps that should repeat.`,
    },
    "operations-tracker": { name: t`Tracker`, line: t`Notes status, blockers, and what is done.` },
  };
  return {
    sectors,
    members,
    heading: t`What should your team handle?`,
    intro: t`Describe the work in a sentence or two. You can start on Mycellios credits, and an API key stays optional.`,
    placeholder: t`For example: reply to customer email and find new leads`,
    gallery: t`Or start from a role`,
    putToWork: t`Create and open this team`,
    questionsIntro: t`A few questions so the team fits.`,
    proposal: t`Your team`,
    credits: t`Use your model or start with Mycellios credits.`,
    setupCost: t`Creating your team uses no credits. You choose when to start.`,
    ownProvider: t`Use your own provider`,
    singleMico: t`Start with one Mico`,
    creating: t`Creating your team…`,
    creditsUnavailable: t`Mycellios credits are unavailable right now. No credits were spent.`,
    createFailed: t`Could not create the team. Try again.`,
    who: t`Who is this for?`,
    audiences: {
      me: t`Just me`,
      team: t`A small team`,
      customers: t`Customers`,
    } satisfies Record<TeamAudience, string>,
    first: t`What should they do first?`,
    starts: {
      research: t`Research and brief me`,
      drafts: t`Draft work for me to review`,
      process: t`Run a repeatable process`,
    } satisfies Record<TeamStart, string>,
    closest: t`Which role is closest?`,
  };
}
