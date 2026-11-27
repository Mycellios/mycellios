import { describe, expect, it } from "vitest";
import { isVocabularyEcho, spokenApprovalAction } from "./speech-text.js";

/**
 * Scenario battery for spoken calls, grouped like the questions a reviewer asks: does a voice
 * ever authorize something nobody said, in either language, and does noise ever count as the
 * person? Deterministic: it checks the gates a live model cannot bypass, not a model's replies.
 */
const APPROVAL = [{ id: "allow" }, { id: "always" }, { id: "deny" }];

const scenarios: Record<string, Array<[heard: string, expected: "allow" | "deny" | null]>> = {
  "authorization: a clear answer decides": [
    ["Yes.", "allow"],
    ["Yes, go ahead.", "allow"],
    ["Okay, thanks.", "allow"],
    ["Sí.", "allow"],
    ["Sí, adelante.", "allow"],
    ["Vale, hazlo.", "allow"],
    ["Dale.", "allow"],
    ["De acuerdo, por favor.", "allow"],
    ["No.", "deny"],
    ["No, thanks.", "deny"],
    ["Cancel it.", "deny"],
    ["No, mejor no.", "deny"],
    ["Cancélalo.", "deny"],
    ["Ahora no.", "deny"],
  ],
  "authorization: anything less is never a yes": [
    ["Yes, but first tell me who gets it.", null],
    ["Sí, pero antes léeme el correo.", null],
    ["Si quieres, luego lo vemos.", null],
    ["Sure, whatever you think is best for the logs", null],
    ["What does it send?", null],
    ["¿A quién se lo mandas?", null],
    ["Yes. No.", null],
    ["Sí no sé", null],
  ],
  "limits: always-allow is only on screen": [
    ["Always allow.", null],
    ["Permítelo siempre.", null],
    ["Sí, siempre.", null],
  ],
  "listening: speech-model noise is not the person": [
    ["Thanks for watching!", null],
    ["Gracias por ver el vídeo.", null],
    ["Subtítulos realizados por la comunidad de Amara.org", null],
    ["¡Suscríbete!", null],
    ["...", null],
    ["", null],
  ],
};

describe("voice scenarios", () => {
  for (const [category, cases] of Object.entries(scenarios)) {
    describe(category, () => {
      it.each(cases)("%j → %s", (heard, expected) => {
        expect(spokenApprovalAction(heard, APPROVAL)).toBe(expected);
      });
    });
  }

  describe("listening: a model reciting its hints is not the person", () => {
    const vocabulary = ["Ada", "Bruno", "Mycellios", "Mico"];
    it.each([
      ["Ada, Bruno, Mycellios, Mico.", true],
      ["Mycellios. Mico.", true],
      ["Ada", false],
      ["Ada, dile a Bruno que siga", false],
      ["Pregúntale a Mico por Mycellios", false],
    ])("%j → echo %s", (heard, echo) => {
      expect(isVocabularyEcho(heard, vocabulary)).toBe(echo);
    });
  });
});
