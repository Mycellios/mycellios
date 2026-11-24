// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { sampleDocx } from "../../e2e/fixtures/docx-sample";
import { convertDocxToHtml } from "./docx-convert";
import {
  DOCX_PREVIEW_MAX_BYTES,
  DocxPreviewError,
  declaredExpandedSize,
  docxPreviewHtml,
  sanitizeDocxHtml,
} from "./docx-preview";

// Node resolves mammoth's Node entry, which reads only paths and Buffers. Load its published
// browser build instead, the code the web bundle actually ships.
vi.mock("mammoth", async () => {
  const browserBuild = "mammoth/mammoth.browser.js";
  return { default: (await import(/* @vite-ignore */ browserBuild)).default };
});

// Runs the real converter in-process; the browser runs the same function in a worker.
const convert = (bytes: Uint8Array) => convertDocxToHtml(bytes.slice().buffer);

function render(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("docx preview", () => {
  it("converts headings, lists, tables and emphasis into sanitized HTML", async () => {
    const root = render(await docxPreviewHtml(await sampleDocx(), { convert }));
    expect(root.querySelector("h1")?.textContent).toBe("Quarterly report");
    expect(root.querySelector("h2")?.textContent).toBe("Highlights");
    expect([...root.querySelectorAll("ul > li")].map((item) => item.textContent)).toEqual([
      "Revenue grew",
      "Costs fell",
    ]);
    expect([...root.querySelectorAll("table tr")].map((row) => row.textContent)).toEqual([
      "RegionTotal",
      "North42",
    ]);
    expect(root.querySelector("strong")?.textContent).toBe("Bold");
    expect(root.querySelector("em")?.textContent).toBe("italic");
    expect(root.querySelector("u")?.textContent).toBe("underlined");
    expect(root.querySelector("s")?.textContent).toBe("struck");
    // Document text that looks like markup stays text.
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>window.ranDocx = true</script>");
    const unsafe = [...root.querySelectorAll("a")].find((a) => a.textContent === "Unsafe link");
    expect(unsafe?.hasAttribute("href")).toBe(false);
    const web = [...root.querySelectorAll("a")].find((a) => a.textContent === "Project site");
    expect(web?.getAttribute("href")).toBe("https://example.com/");
    expect(web?.getAttribute("target")).toBe("_blank");
    expect(web?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("removes scripts, handlers, styles and images that are not embedded in the file", async () => {
    const pixel = "data:image/png;base64,iVBORw0KGgo=";
    const root = render(
      await sanitizeDocxHtml(
        [
          '<p onclick="alert(1)" style="background:url(https://tracker.test/a)">Text</p>',
          "<script>alert(1)</script>",
          '<img src="https://tracker.test/pixel.png" alt="remote">',
          '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="svg">',
          `<img src="${pixel}" alt="embedded" onerror="alert(1)">`,
          '<a href="javascript:alert(1)">bad</a>',
          '<a href="#docx-footnote-1">note</a>',
          '<iframe src="https://tracker.test"></iframe>',
          '<form action="https://tracker.test"><input></form>',
        ].join(""),
      ),
    );
    expect(
      root.querySelector("script, iframe, form, input, [style], [onclick], [onerror]"),
    ).toBeNull();
    expect([...root.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
      pixel,
    ]);
    expect(root.querySelector("a:not([href])")?.textContent).toBe("bad");
    expect(root.querySelector("a[href='#docx-footnote-1']")?.getAttribute("target")).toBeNull();
  });

  it("refuses files over the preview size before converting them", async () => {
    const converter = vi.fn();
    await expect(
      docxPreviewHtml(new Uint8Array(DOCX_PREVIEW_MAX_BYTES + 1), { convert: converter }),
    ).rejects.toMatchObject({ reason: "too_large" });
    expect(converter).not.toHaveBeenCalled();
  });

  it("refuses archives that declare too much uncompressed content", async () => {
    const bytes = await sampleDocx();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entry = bytes.findIndex(
      (_, index) => index + 4 <= bytes.length && view.getUint32(index, true) === 0x02014b50,
    );
    view.setUint32(entry + 24, 200 * 1024 * 1024, true);
    expect(declaredExpandedSize(bytes)).toBeGreaterThan(200 * 1024 * 1024);
    const converter = vi.fn();
    await expect(docxPreviewHtml(bytes, { convert: converter })).rejects.toMatchObject({
      reason: "too_large",
    });
    expect(converter).not.toHaveBeenCalled();
  });

  it("reports unreadable files and failed conversions", async () => {
    await expect(
      docxPreviewHtml(new TextEncoder().encode("not a zip"), { convert }),
    ).rejects.toMatchObject({ reason: "unreadable" });
    const failure = docxPreviewHtml(await sampleDocx(), {
      convert: () => Promise.reject(new Error("corrupt")),
    });
    await expect(failure).rejects.toBeInstanceOf(DocxPreviewError);
    await expect(failure).rejects.toMatchObject({ reason: "unreadable" });
  });
});
