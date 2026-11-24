import JSZip from "jszip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";

const run = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (content: string, props = "") =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
const listItem = (text: string) =>
  paragraph(run(text), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`);
const cell = (text: string) => `<w:tc>${paragraph(run(text))}</w:tc>`;
const style = (id: string, name: string) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;

/** A small, hand-built Word document with headings, a list, a table, emphasis and links. */
export async function sampleDocx(): Promise<Uint8Array> {
  const body = [
    paragraph(run("Quarterly report"), `<w:pStyle w:val="Heading1"/>`),
    paragraph(
      [
        run("Bold", "<w:b/>"),
        run(", "),
        run("italic", "<w:i/>"),
        run(", "),
        run("underlined", `<w:u w:val="single"/>`),
        run(" and "),
        run("struck", "<w:strike/>"),
        run(" text."),
      ].join(""),
    ),
    paragraph(run("Highlights"), `<w:pStyle w:val="Heading2"/>`),
    listItem("Revenue grew"),
    listItem("Costs fell"),
    `<w:tbl><w:tr>${cell("Region")}${cell("Total")}</w:tr><w:tr>${cell("North")}${cell("42")}</w:tr></w:tbl>`,
    paragraph(run("&lt;script&gt;window.ranDocx = true&lt;/script&gt;")),
    paragraph(`<w:hyperlink r:id="rIdScript">${run("Unsafe link")}</w:hyperlink>`),
    paragraph(`<w:hyperlink r:id="rIdWeb">${run("Project site")}</w:hyperlink>`),
  ].join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PACKAGE_RELS}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PACKAGE_RELS}"><Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="${R}/numbering" Target="numbering.xml"/><Relationship Id="rIdScript" Type="${R}/hyperlink" Target="javascript:window.ranDocx=true" TargetMode="External"/><Relationship Id="rIdWeb" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}">${style("Heading1", "heading 1")}${style("Heading2", "heading 2")}</w:styles>`,
  );
  zip.file(
    "word/numbering.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
