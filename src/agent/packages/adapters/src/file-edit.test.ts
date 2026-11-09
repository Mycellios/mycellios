import { describe, expect, it } from "vitest";
import { applyFileEdit, sliceFileContent } from "./file-edit.js";

describe("applyFileEdit", () => {
  it("replaces one exact block and keeps the rest of the file", () => {
    const content = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const result = applyFileEdit({
      content,
      oldString: "const b = 2;",
      newString: "const b = 20;",
    });
    expect(result).toMatchObject({ ok: true, replacements: 1 });
    if (!result.ok) throw new Error(result.error);
    expect(result.content).toBe("const a = 1;\nconst b = 20;\nconst c = 3;\n");
  });

  it("treats replacement text literally, including dollar patterns", () => {
    const result = applyFileEdit({
      content: "price = 1;\n",
      oldString: "1",
      newString: "$& and $1 stay literal",
    });
    expect(result.ok && result.content).toBe("price = $& and $1 stay literal;\n");
  });

  it("refuses an ambiguous match unless replace_all is set", () => {
    const ambiguous = applyFileEdit({
      content: "x\nx\n",
      oldString: "x",
      newString: "y",
    });
    expect(ambiguous).toMatchObject({ ok: false });
    if (ambiguous.ok) throw new Error("expected refusal");
    expect(ambiguous.error).toContain("appears 2 times");

    const all = applyFileEdit({
      content: "x\nx\n",
      oldString: "x",
      newString: "y",
      replaceAll: true,
    });
    expect(all).toMatchObject({ ok: true, replacements: 2 });
    if (!all.ok) throw new Error(all.error);
    expect(all.content).toBe("y\ny\n");
  });

  it("refuses missing, empty and no-op edits", () => {
    expect(applyFileEdit({ content: "a", oldString: "b", newString: "c" })).toMatchObject({
      ok: false,
    });
    expect(applyFileEdit({ content: "a", oldString: "", newString: "c" })).toMatchObject({
      ok: false,
    });
    expect(applyFileEdit({ content: "a", oldString: "a", newString: "a" })).toMatchObject({
      ok: false,
    });
  });

  it("matches LF edits against a CRLF file and preserves CRLF", () => {
    const content = "one\r\ntwo\r\nthree\r\n";
    const result = applyFileEdit({
      content,
      oldString: "one\ntwo",
      newString: "one\nTWO",
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.content).toBe("one\r\nTWO\r\nthree\r\n");
  });
});

describe("sliceFileContent", () => {
  const content = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");

  it("returns a one-based window without reading the whole file", () => {
    expect(sliceFileContent(content, 3, 2)).toEqual({
      content: "line 3\nline 4",
      startLine: 3,
      endLine: 4,
      totalLines: 10,
      truncated: true,
    });
  });

  it("defaults to the first lines and clamps past the end", () => {
    expect(sliceFileContent(content, undefined, undefined)).toMatchObject({
      startLine: 1,
      endLine: 10,
      truncated: false,
    });
    expect(sliceFileContent(content, 99, 5)).toMatchObject({ startLine: 10, endLine: 10 });
  });
});
