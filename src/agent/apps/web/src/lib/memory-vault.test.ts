import { markdownMentionHref, markdownMentionId } from "@mycellios/chat-ui/web";
import { memoryNotePath } from "@mycellios/contracts";
import { describe, expect, it } from "vitest";
import {
  buildVaultGraph,
  createLinkResolver,
  folderTree,
  GHOST_PREFIX,
  matchesVaultQuery,
  neighbourhood,
  noteTitle,
  parseWikiLinks,
  subgraph,
  type VaultNote,
  vaultDisplayPath,
  wikiLinksAsMentions,
} from "./memory-vault";

function note(
  id: string,
  path: string,
  content = "",
  owner: { scope: "user" | "bot"; botId: string | null } = { scope: "user", botId: null },
): VaultNote {
  return {
    id,
    path,
    content,
    revision: 1,
    updatedAt: "2026-11-27T10:00:00.000Z",
    inclusion: "searchable",
    userControlled: false,
    taskThreadId: null,
    ...owner,
  };
}
const mico = (botId: string) => ({ scope: "bot" as const, botId });

describe("parseWikiLinks", () => {
  it("reads targets, headings and aliases", () => {
    expect(
      parseWikiLinks("See [[Trips/Japan#Budget|the budget]] and [[people]].").map(
        ({ target, heading, alias }) => ({ target, heading, alias }),
      ),
    ).toEqual([
      { target: "Trips/Japan", heading: "Budget", alias: "the budget" },
      { target: "people", heading: undefined, alias: undefined },
    ]);
  });

  it("ignores links inside code spans and fenced blocks", () => {
    const text = "Use `[[not a link]]`.\n\n```\n[[also not]]\n```\n\nBut [[real]].";
    expect(parseWikiLinks(text).map((link) => link.target)).toEqual(["real"]);
  });

  it("skips empty and nested brackets", () => {
    expect(parseWikiLinks("[[ ]] [[a[b]]] [[ok]]").map((link) => link.target)).toEqual(["ok"]);
  });
});

describe("link resolution", () => {
  const notes = [
    note("g-profile", "profile.md"),
    note("a-profile", "profile.md", "", mico("bot-a")),
    note("b-trips", "trips/japan.md", "", mico("bot-b")),
    note("g-food", "food.md"),
  ];
  const resolve = createLinkResolver(notes);

  it("prefers the note in the linking note's own group", () => {
    expect(resolve({ scope: "bot", botId: "bot-a" }, "profile")).toBe("a-profile");
    expect(resolve({ scope: "user", botId: null }, "profile")).toBe("g-profile");
  });

  it("falls back to General, then to a unique note anywhere", () => {
    expect(resolve({ scope: "bot", botId: "bot-b" }, "profile")).toBe("g-profile");
    expect(resolve({ scope: "user", botId: null }, "japan")).toBe("b-trips");
    expect(resolve({ scope: "user", botId: null }, "Trips/Japan.md")).toBe("b-trips");
  });

  it("matches case-insensitively and leaves missing targets unresolved", () => {
    expect(resolve({ scope: "user", botId: null }, "FOOD")).toBe("g-food");
    expect(resolve({ scope: "user", botId: null }, "nowhere")).toBeNull();
  });

  it("does not guess between two notes of other groups", () => {
    const ambiguous = createLinkResolver([
      note("a", "plan.md", "", mico("bot-a")),
      note("b", "plan.md", "", mico("bot-b")),
    ]);
    expect(ambiguous({ scope: "user", botId: null }, "plan")).toBeNull();
  });
});

describe("buildVaultGraph", () => {
  it("draws one edge per linked pair, backlinks and ghost notes", () => {
    const notes = [
      note("a", "a.md", "[[b]] [[b]] [[missing note]] [[a]]"),
      note("b", "b.md", "back to [[a]]"),
      note("c", "c.md", "nothing"),
    ];
    const graph = buildVaultGraph(notes);
    expect(graph.edges).toEqual([
      { source: "a", target: "b" },
      { source: "a", target: `${GHOST_PREFIX}missing note` },
    ]);
    expect(graph.backlinks.get("a")).toEqual(["b"]);
    expect(graph.backlinks.get("b")).toEqual(["a"]);
    expect(graph.outgoing.get("a")).toEqual(["b"]);
    const ghost = graph.nodes.find((node) => node.ghost);
    expect(ghost).toMatchObject({ label: "missing note", group: "ghost", degree: 1 });
    expect(graph.nodes.find((node) => node.id === "c")?.degree).toBe(0);
  });

  it("limits the local graph to the chosen depth", () => {
    const graph = buildVaultGraph([
      note("a", "a.md", "[[b]]"),
      note("b", "b.md", "[[c]]"),
      note("c", "c.md", "[[d]]"),
      note("d", "d.md"),
    ]);
    expect([...neighbourhood(graph, "a", 1)].sort()).toEqual(["a", "b"]);
    expect([...neighbourhood(graph, "b", 1)].sort()).toEqual(["a", "b", "c"]);
    expect(subgraph(graph, neighbourhood(graph, "a", 2)).edges).toHaveLength(2);
  });
});

describe("vault helpers", () => {
  it("titles notes by file name", () => {
    expect(noteTitle("reviews/likes-tea.md")).toBe("likes-tea");
    expect(noteTitle("MEMORY.md")).toBe("MEMORY");
  });

  it("nests folders before notes", () => {
    const tree = folderTree([
      note("1", "z.md"),
      note("2", "reviews/b.md"),
      note("3", "reviews/a.md"),
      note("4", "a/deep/x.md"),
    ]);
    expect(tree.folders.map((folder) => folder.name)).toEqual(["a", "reviews"]);
    expect(tree.folders[1]!.notes.map((entry) => entry.id)).toEqual(["3", "2"]);
    expect(tree.folders[0]!.folders[0]!.notes[0]!.id).toBe("4");
    expect(tree.notes.map((entry) => entry.id)).toEqual(["1"]);
  });

  it("searches without case or accents", () => {
    expect(matchesVaultQuery({ path: "viajes.md", content: "Vuelo a Japón" }, "japon")).toBe(true);
    expect(matchesVaultQuery({ path: "viajes.md", content: "Vuelo" }, "tren")).toBe(false);
  });

  it("renders links as mention links and keeps code literal", () => {
    const notes = [
      note("a", "a.md", "Go to [[b|B note]], see [[nope]] and `[[code]]`"),
      note("b", "b.md"),
    ];
    const output = wikiLinksAsMentions(notes[0]!, createLinkResolver(notes));
    expect(output).toBe(
      `Go to [B note](${markdownMentionHref("memory-note:b")}), see [nope](${markdownMentionHref("memory-new:nope")}) and \`[[code]]\``,
    );
    expect(markdownMentionId(markdownMentionHref("memory-note:b"))).toBe("memory-note:b");
  });
});

describe("memoryNotePath", () => {
  it("adds the extension and keeps folders", () => {
    expect(memoryNotePath("Trips/Japan")).toBe("Trips/Japan.md");
    expect(memoryNotePath(" notes\\ideas.md ")).toBe("notes/ideas.md");
  });

  it("refuses traversal, hidden folders, task notes and empty names", () => {
    expect(memoryNotePath("../secret")).toBeNull();
    expect(memoryNotePath(".hidden/x")).toBeNull();
    expect(memoryNotePath("tasks/abc/x")).toBeNull();
    expect(memoryNotePath("  //  ")).toBeNull();
    expect(memoryNotePath("a".repeat(250))).toBeNull();
  });

  it("drops characters that break links", () => {
    expect(memoryNotePath("plan [v2] #1|x")).toBe("plan v2 1x.md");
  });
});

describe("task conversation notes", () => {
  const task = {
    ...note("t", "tasks/thread-1/trip ideas.md", "See [[profile]]", mico("bot-a")),
    taskThreadId: "thread-1",
    taskThreadTitle: "Plan / Japan",
  };

  it("show under the conversation title instead of the stored folder", () => {
    expect(vaultDisplayPath(task, "Conversation notes", "Untitled")).toBe(
      "Conversation notes/Plan ∕ Japan/trip ideas.md",
    );
    expect(vaultDisplayPath({ ...task, taskThreadTitle: null }, "C", "Untitled")).toBe(
      "C/Untitled/trip ideas.md",
    );
    expect(vaultDisplayPath(note("n", "a/b.md"), "C", "U")).toBe("a/b.md");
  });

  it("link out but are never the target of a link", () => {
    const notes = [task, note("p", "profile.md")];
    const resolve = createLinkResolver(notes);
    expect(resolve({ scope: "bot", botId: "bot-a" }, "trip ideas")).toBeNull();
    expect(buildVaultGraph(notes).edges).toEqual([{ source: "t", target: "p" }]);
  });
});
