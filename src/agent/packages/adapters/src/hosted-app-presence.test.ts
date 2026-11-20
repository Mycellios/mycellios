import { describe, expect, it } from "vitest";
import { changedCssSelector, changedHtmlSelector, presenceTarget } from "./hosted-app-presence.js";

const PAGE = `<!doctype html><html><head><title>x</title><style>p{color:red}</style></head>
<body><header><h1>Hi</h1></header><main><section><p>One</p></section><section id="pricing"><p>Two</p><p>Three</p></section></main></body></html>`;

describe("changedHtmlSelector", () => {
  it("points at the element that contains the first change", () => {
    expect(changedHtmlSelector(PAGE, PAGE.replace("One", "Uno"))).toBe(
      "body > main:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(1)",
    );
  });

  it("anchors at the nearest id", () => {
    expect(changedHtmlSelector(PAGE, PAGE.replace("Three", "Tres"))).toBe(
      "#pricing > p:nth-of-type(2)",
    );
  });

  it("returns nothing for unchanged files or head-only edits", () => {
    expect(changedHtmlSelector(PAGE, PAGE)).toBeUndefined();
    expect(changedHtmlSelector(PAGE, PAGE.replace("<title>x", "<title>y"))).toBeUndefined();
  });

  it("skips raw text and void elements without losing the path", () => {
    const before = `<body><img src="a.png"><script>if (a < b) {}</script><p>x</p></body>`;
    expect(changedHtmlSelector(before, before.replace("<p>x", "<p>y"))).toBe(
      "body > p:nth-of-type(1)",
    );
  });

  it("handles a new file", () => {
    expect(changedHtmlSelector("", "<body><main><p>new</p></main></body>")).toBe("body");
  });
});

describe("changedCssSelector", () => {
  it("returns the first changed or added rule's selector", () => {
    const before = ".hero { color: red } .card, .tile { margin: 0 }";
    expect(changedCssSelector(before, before.replace("margin: 0", "margin: 4px"))).toBe(".card");
    expect(changedCssSelector(before, `${before} .footer { gap: 2px }`)).toBe(".footer");
  });

  it("ignores at-rules", () => {
    expect(changedCssSelector("", "@media (max-width: 4px) { .a { b: c } }")).toBeUndefined();
  });
});

describe("presenceTarget", () => {
  it("falls back to the file", () => {
    expect(presenceTarget("app.js", "a", "b")).toEqual({ kind: "file", value: "app.js" });
    expect(presenceTarget("index.html", PAGE, PAGE.replace("Hi", "Hola"))).toEqual({
      kind: "selector",
      value: "body > header:nth-of-type(1) > h1:nth-of-type(1)",
    });
  });
});
