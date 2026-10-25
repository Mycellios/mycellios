import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, DialogPanel, Field, Form, Heading, Input, Link, Select, Table, TableBody, TableCell, TableRow, Textarea } from "./primitives";

describe("shared production UI primitives", () => {
  it("normalizes account submit and primary actions through the same variant", () => {
    const account = renderToStaticMarkup(<Button className="account-submit" type="submit">Sign in</Button>);
    const primary = renderToStaticMarkup(<Button className="primary-button">Activate</Button>);
    expect(account).toContain('data-variant="primary"');
    expect(primary).toContain('data-variant="primary"');
    expect(account).toContain('type="submit"');
    expect(account).toContain('class="ui-button account-submit"');
  });
  it("disables loading buttons without submitting and preserves accessible state", () => {
    const html = renderToStaticMarkup(<Button loading type="button" aria-label="Connect device">Connecting</Button>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Connect device"');
    expect(html).toContain('type="button"');
  });
  it("preserves native form validation, labels and error descriptions", () => {
    const html = renderToStaticMarkup(<Form action="/account" method="post"><Field htmlFor="email" label="Email" error="Invalid email"><Input id="email" name="email" type="email" required aria-describedby="email-error" aria-invalid="true" /></Field><Textarea name="notes" maxLength={100} /><Select name="power"><option value="low">Low</option></Select></Form>);
    expect(html).toContain('for="email"');
    expect(html).toContain('type="email"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('id="email-error" role="alert"');
    expect(html).toContain('method="post"');
    expect(html).toContain('<textarea');
    expect(html).toContain('<select');
  });
  it("keeps link navigation and download semantics", () => {
    const html = renderToStaticMarkup(<Link href="/downloads/app.zip" download target="_blank" rel="noreferrer" variant="primary">Download</Link>);
    expect(html).toContain('<a ');
    expect(html).toContain('href="/downloads/app.zip"');
    expect(html).toContain('download=""');
    expect(html).toContain('data-variant="primary"');
  });
  it("keeps headings, modal ownership and valid table elements", () => {
    const html = renderToStaticMarkup(<DialogPanel as="aside" role="dialog" aria-modal="true" aria-labelledby="title" tabIndex={-1}><Heading as="h1" id="title">Devices</Heading><Table><TableBody><TableRow><TableCell>Connected</TableCell></TableRow></TableBody></Table></DialogPanel>);
    expect(html).toContain('<aside');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('<h1');
    expect(html).toContain('<table');
    expect(html).toContain('<tbody');
    expect(html).toContain('<tr');
    expect(html).toContain('<td');
  });
});
