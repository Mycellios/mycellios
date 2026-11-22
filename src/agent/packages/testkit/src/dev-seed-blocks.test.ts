import { MessageBlock } from "@mycellios/contracts";
import { describe, expect, it } from "vitest";

// The dev seed is a plain script module; load it by path so its JavaScript stays outside this package's types.
const seedModule = new URL("../../../scripts/desktop-dev-seed-data.mjs", import.meta.url).href;

describe("Mycellios Dev seed data", () => {
  it("writes only message blocks the message contract accepts", async () => {
    const { SEED_CONVERSATIONS } = (await import(seedModule)) as {
      SEED_CONVERSATIONS: Record<string, { blocks: Record<string, unknown>[] }[]>;
    };
    const fileBlock = { kind: "file", artifactId: "a1", mimeType: "text/plain", name: "x.txt", size: 1 };
    const issues: string[] = [];
    for (const [thread, rows] of Object.entries(SEED_CONVERSATIONS))
      for (const row of rows)
        for (const block of row.blocks) {
          const parsed = MessageBlock.safeParse(typeof block.file === "string" ? fileBlock : block);
          if (!parsed.success) issues.push(`${thread}: ${JSON.stringify(parsed.error.issues)}`);
        }
    expect(issues).toEqual([]);
  });
});
