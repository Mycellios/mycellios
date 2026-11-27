import { describe, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: String.raw }) }));
vi.mock("@mycellios/ui-web", () => ({ GroupAvatar: () => null }));
import { pickThinkingPhrase, thinkingPhraseIndex } from "./ThinkingActivity";

describe("thinking phrase per turn", () => {
  it("keeps one phrase for the whole turn", () => {
    const first = thinkingPhraseIndex("turn-keep", () => 0.1);
    expect(thinkingPhraseIndex("turn-keep", () => 0.9)).toBe(first);
  });

  it("never repeats the previous turn's phrase", () => {
    const a = thinkingPhraseIndex("turn-a", () => 0.2);
    const b = thinkingPhraseIndex("turn-b", () => 0.2);
    expect(b).not.toBe(a);
  });

  it("draws mostly plain phrases and sometimes a playful one", () => {
    expect(thinkingPhraseIndex("turn-plain", () => 0.5)).toBeLessThan(7);
    const playful = thinkingPhraseIndex("turn-playful", () => 0.1);
    expect(playful).toBeGreaterThanOrEqual(7);
    expect(playful).toBeLessThan(10);
  });

  it("moves to a different phrase at each change", () => {
    for (let current = 0; current < 10; current += 1) {
      for (const roll of [0.05, 0.25, 0.5, 0.95]) expect(pickThinkingPhrase(current, () => roll)).not.toBe(current);
    }
  });
});
