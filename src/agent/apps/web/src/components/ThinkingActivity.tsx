import { useLingui } from "@lingui/react/macro";
import { GroupAvatar, type GroupAvatarMember } from "@mycellios/ui-web";
import { useEffect, useState } from "react";

/**
 * A working Mico: a light passes along the activity text beside its avatar. The text alone
 * says it is working, so the avatar carries no extra marks. Flat colours only; the light
 * rests when motion is reduced. A changing phrase passes `spoken`: screen readers keep that
 * one steady line instead of hearing every new phrase.
 */
export function ActivityShine({ text, spoken }: { text: string; spoken?: string }) {
  // The light is drawn from data-text by CSS, so the text is read (and tested) once.
  if (!spoken || spoken === text) {
    return <span className="rk-activity-label" data-text={text}>{text}</span>;
  }
  return <>
    <span key={text} aria-hidden="true" className="rk-activity-label" data-text={text} data-swap="">{text}</span>
    <span className="sr-only">{spoken}</span>
  </>;
}

/** How long each thinking phrase stays before the next one. */
export const THINKING_PHRASE_MS = 3200;
/** Plain phrases come first; the last ones are the playful pool. */
const FACTUAL_PHRASES = 7;
const PHRASE_COUNT = 10;
/** Chance of a playful phrase at each pick. */
const PLAYFUL_SHARE = 0.3;

const chosen = new Map<string, number>();
let previous: number | undefined;

/** A random phrase, mostly plain and sometimes playful, never `avoid`. */
export function pickThinkingPhrase(avoid: number | undefined, random: () => number = Math.random): number {
  const playful = random() < PLAYFUL_SHARE;
  const start = playful ? FACTUAL_PHRASES : 0;
  const size = playful ? PHRASE_COUNT - FACTUAL_PHRASES : FACTUAL_PHRASES;
  const index = start + Math.min(size - 1, Math.floor(random() * size));
  return index === avoid ? start + ((index - start + 1) % size) : index;
}

/** The phrase a turn opens with: kept for that turn, never the previous turn's opening. */
export function thinkingPhraseIndex(key: string, random: () => number = Math.random): number {
  const known = chosen.get(key);
  if (known !== undefined) return known;
  const index = pickThinkingPhrase(previous, random);
  previous = index;
  chosen.set(key, index);
  if (chosen.size > 64) chosen.delete(chosen.keys().next().value!);
  return index;
}

/**
 * While a Mico thinks without a reported step, its line moves through short phrases every few
 * seconds (our own phrases). They stay generic: none claims a search, a file or a command the
 * runtime has not reported; a real step replaces them. `spoken` is the steady line for screen
 * readers.
 */
export function useThinkingLabel(turnKey: string, active = true): { text: string; spoken: string } {
  const { t } = useLingui();
  const phrases = [
    t`Thinking it through…`,
    t`On it…`,
    t`Looking at it closely…`,
    t`Weighing the options…`,
    t`Going over the details…`,
    t`Piecing it together…`,
    t`Getting the answer ready…`,
    t`The spores are busy…`,
    t`Growing an idea…`,
    t`Asking the mycelium…`,
  ];
  const [shown, setShown] = useState(() => ({ key: turnKey, index: thinkingPhraseIndex(turnKey) }));
  const index = shown.key === turnKey ? shown.index : thinkingPhraseIndex(turnKey);
  useEffect(() => {
    setShown({ key: turnKey, index: thinkingPhraseIndex(turnKey) });
    if (!active) return;
    const timer = window.setInterval(
      () => setShown((current) => ({ key: turnKey, index: pickThinkingPhrase(current.index) })),
      THINKING_PHRASE_MS,
    );
    return () => window.clearInterval(timer);
  }, [turnKey, active]);
  return { text: phrases[index] ?? phrases[0]!, spoken: phrases[0]! };
}

export function ThinkingAvatar({ members, size }: {
  members: GroupAvatarMember[];
  size: number;
  /** Kept for callers; the avatar looks the same whether or not the Mico is working. */
  active?: boolean;
}) {
  const color = members[0]?.color;
  return <span className="rk-thinking-avatar" style={color ? { color } : undefined}>
    <GroupAvatar members={members} size={size} />
  </span>;
}
