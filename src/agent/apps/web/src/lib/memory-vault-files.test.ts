import { describe, expect, it } from "vitest";
import {
  safeFolderName,
  vaultExportFiles,
  vaultImportPlan,
  withoutVaultProperties,
  withVaultProperties,
} from "./memory-vault-files";

const groups = [
  { key: "general", label: "General" },
  { key: "bot-a", label: "Viajera" },
];

describe("vault export", () => {
  it("writes one folder per group and keeps note folders", () => {
    expect(
      vaultExportFiles([
        { label: "General", notes: [{ path: "profile.md", content: "Ana" }] },
        { label: "Viajera", notes: [{ path: "trips/japan.md", content: "Kyoto" }] },
        { label: "viajera", notes: [{ path: "x.md", content: "" }] },
      ]).map((file) => file.path),
    ).toEqual(["General/profile.md", "Viajera/trips/japan.md", "viajera (2)/x.md"]);
  });

  it("makes names safe for any file system", () => {
    expect(safeFolderName('A/B: "c"?. ')).toBe("A B c");
    expect(safeFolderName("...")).toBe("Notes");
  });
});

describe("vault import", () => {
  it("sends exported group folders back to their group and the rest to the destination", () => {
    const plan = vaultImportPlan(
      [
        { path: "Viajera/trips/japan.md", content: "Kyoto" },
        { path: "General/profile.md", content: "Ana" },
        { path: "loose.md", content: "x" },
        { path: "Other/deep/note.MD", content: "y" },
      ],
      groups,
      "bot-a",
      "Conversation notes",
    );
    expect(plan.items).toEqual([
      { group: "bot-a", path: "trips/japan.md", content: "Kyoto" },
      { group: "general", path: "profile.md", content: "Ana" },
      { group: "bot-a", path: "loose.md", content: "x" },
      { group: "bot-a", path: "Other/deep/note.MD", content: "y" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips files it cannot turn into notes", () => {
    const plan = vaultImportPlan(
      [
        { path: "image.png", content: "" },
        { path: "Viajera/Conversation notes/Trip/a.md", content: "" },
        { path: "big.md", content: "x".repeat(64_001) },
        { path: "../escape.md", content: "" },
        { path: "same.md", content: "1" },
        { path: "SAME.md", content: "2" },
      ],
      groups,
      "general",
      "Conversation notes",
    );
    expect(plan.items).toEqual([{ group: "general", path: "same.md", content: "1" }]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual([
      "not_markdown",
      "conversation_note",
      "too_large",
      "invalid_name",
      "invalid_name",
    ]);
  });
});

describe("Obsidian properties", () => {
  const properties = {
    owner: 'Viajera "test"',
    alwaysIncluded: true,
    updated: "2026-11-27T10:00:00.000Z",
    conversation: "Plan del viaje",
  };

  it("adds them on export and removes them on import", () => {
    const exported = withVaultProperties("Kyoto in May. See [[profile]].", properties);
    expect(exported).toBe(
      [
        "---",
        "mycellios: memory",
        'owner: "Viajera \\"test\\""',
        "always_included: true",
        "updated: 2026-11-27",
        'conversation: "Plan del viaje"',
        "---",
        "Kyoto in May. See [[profile]].",
      ].join("\n"),
    );
    expect(withoutVaultProperties(exported)).toBe("Kyoto in May. See [[profile]].");
    const plan = vaultImportPlan(
      [{ path: "Viajera/japan.md", content: exported }],
      groups,
      "general",
      "C",
    );
    expect(plan.items[0]).toEqual({
      group: "bot-a",
      path: "japan.md",
      content: "Kyoto in May. See [[profile]].",
    });
  });

  it("keeps a note's own properties and never strips foreign ones", () => {
    const own = "---\ntags: [trip]\n---\nText";
    expect(withVaultProperties(own, properties)).toBe(own);
    expect(withoutVaultProperties(own)).toBe(own);
  });
});
