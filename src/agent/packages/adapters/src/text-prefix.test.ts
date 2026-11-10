import { describe, expect, it } from "vitest";
import { commonPrefixLength, restartsReply } from "./text-prefix.js";

describe("restartsReply", () => {
  it("treats a retry that opens like the interrupted reply as a restart", () => {
    expect(restartsReply("Voy a comprobar si tu c", "Voy a comp")).toBe(true);
    expect(restartsReply("Voy a comprobar si tu c", "Voy a revisar la carta oferta")).toBe(true);
  });

  it("keeps a genuine continuation as a continuation", () => {
    expect(restartsReply("Done with the first part, ", "now the second part.")).toBe(false);
    expect(restartsReply("Te resumo la oferta: ", "el salario son 48.000 euros")).toBe(false);
  });

  it("ignores empty text and short coincidences", () => {
    expect(restartsReply("", "Voy a comprobar")).toBe(false);
    expect(restartsReply("Voy a comprobar", "")).toBe(false);
    expect(restartsReply("Voy a comprobar", "Voy")).toBe(false);
  });

  it("counts the shared opening regardless of leading space", () => {
    expect(commonPrefixLength("abc", "abd")).toBe(2);
    expect(restartsReply("  Voy a comprobar", "Voy a comprobar la carta")).toBe(true);
  });
});
