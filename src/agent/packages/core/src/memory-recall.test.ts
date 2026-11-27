import { describe, expect, it } from "vitest";
import { recallExcerpt, recallMemories, recallStem } from "./memory-recall.js";

const note = (path: string, content: string, updatedAt = "2026-01-01") => ({ path, content, updatedAt });
const paths = (hits: Array<{ document: { path: string } }>) => hits.map((hit) => hit.document.path);

describe("candidate memory recall", () => {
  it("matches singular and plural, gender and verb forms", () => {
    expect(recallStem("perros")).toBe(recallStem("perro"));
    expect(recallStem("gatos")).toBe(recallStem("gato"));
    expect(recallStem("reuniones")).toBe(recallStem("reunion"));
    expect(recallStem("trabaja")).toBe(recallStem("trabajo"));
    expect(recallStem("hijas")).toBe(recallStem("hijo"));
    expect(paths(recallMemories([note("mascotas.md", "Tiene un gato llamado Miso")], { message: "¿cómo se llaman mis gatos?" }))).toEqual([
      "mascotas.md",
    ]);
  });

  it("never returns notes for an empty, greeting or stop-word-only message", () => {
    const notes = [note("a.md", "Hola, gracias por todo")];
    expect(recallMemories(notes, { message: "de la y" })).toEqual([]);
    expect(recallMemories(notes, { message: "hola, gracias!" })).toEqual([]);
  });

  it("finds one line deep in a long note and excerpts it instead of the beginning", () => {
    const lines = Array.from({ length: 120 }, (_, index) => `Dato sin relación número ${index} sobre la compra semanal.`);
    lines.splice(90, 0, "Su sobrina Carla cumple años el 14 de marzo.");
    const content = lines.join("\n");
    const hits = recallMemories([note("MEMORY.md", content)], { message: "¿cuándo es el cumpleaños de Carla?" });
    expect(paths(hits)).toEqual(["MEMORY.md"]);
    const excerpt = recallExcerpt(content, hits[0]!, 600);
    expect(excerpt).toContain("Carla cumple años el 14 de marzo");
    expect(excerpt.length).toBeLessThanOrEqual(620);
    expect(excerpt.startsWith("…")).toBe(true);
  });

  it("uses the previous message, more weakly, for a follow-up", () => {
    const notes = [note("people/lucia.md", "Lucía vive en Valencia"), note("viajes.md", "Vive la experiencia en Roma")];
    const hits = recallMemories(notes, { message: "¿y dónde vive?", previousMessage: "Háblame de Lucía" });
    expect(paths(hits)[0]).toBe("people/lucia.md");
  });

  it("adds notes linked from a match after the matches, once", () => {
    const notes = [
      note("proyectos/tienda.md", "La tienda online usa [[people/marta]] para el diseño. Ver [[people/marta|Marta]]."),
      note("people/marta.md", "Marta cobra 40 euros la hora."),
      note("otros.md", "Nada que ver"),
    ];
    const hits = recallMemories(notes, { message: "¿qué pasa con la tienda?" });
    expect(hits.map((hit) => [hit.document.path, hit.via])).toEqual([
      ["proyectos/tienda.md", "match"],
      ["people/marta.md", "link"],
    ]);
    expect(recallMemories(notes, { message: "tienda" }, { linkLimit: 0 })).toHaveLength(1);
  });

  it("ranks a note whose path names the topic first and keeps at most the limit", () => {
    const notes = Array.from({ length: 4 }, (_, index) => note(`n${index}.md`, `Alergia mencionada ${index}`));
    for (let index = 0; index < 6; index += 1) notes.push(note(`otra${index}.md`, `Tema sin relación ${index}`));
    notes.push(note("salud/alergias.md", "Alergia a los frutos secos"));
    const hits = recallMemories(notes, { message: "alergias" }, { limit: 3, linkLimit: 0, minScore: 0 });
    expect(hits).toHaveLength(3);
    expect(hits[0]!.document.path).toBe("salud/alergias.md");
    // A word in half the notes, only in their text, is too weak on its own above the threshold.
    expect(paths(recallMemories(notes, { message: "alergias" }, { linkLimit: 0 }))).toEqual(["salud/alergias.md"]);
  });

  it("returns a short note unchanged as its excerpt", () => {
    expect(recallExcerpt("corto", { passages: [] })).toBe("corto");
  });
});

describe("candidate memory recall thresholds", () => {
  it("keeps a weak match in a small vault, where every score is low", () => {
    expect(recallMemories([note("MEMORY.md", "Los martes sale tarde del trabajo")], { message: "¿qué hago el martes?" })).toHaveLength(1);
  });

  it("drops weak single-word matches once the vault is large enough", () => {
    const notes = Array.from({ length: 10 }, (_, index) => note(`n${index}.md`, `Pagos a ${index} días con el proveedor ${index}`));
    expect(recallMemories(notes, { message: "buenos días!" })).toEqual([]);
    expect(recallMemories(notes, { message: "buenos días!" }, { minScore: 0 }).length).toBeGreaterThan(0);
  });
});
