import { Fragment, type ReactNode } from "react";
import { Heading, Link, Text } from "../ui/primitives";
import { MarketingFooter, MarketingHeader } from "./MarketingHeader";
import { legalPlaceholders, PRIVACY, TERMS, type LegalDocument } from "./legal-content";
import "./legal-page.css";

/** `[[...]]` is a fact the owner still has to supply: show it, never hide it. */
function withPlaceholders(text: string): ReactNode {
  return text.split(/(\[\[[^\]]+\]\])/g).map((part, index) => {
    const pending = /^\[\[(.+)\]\]$/.exec(part);
    return pending ? <mark className="legal-pending" key={index}>{pending[1]}</mark> : <Fragment key={index}>{part}</Fragment>;
  });
}

export function LegalPage({ kind }: { kind: LegalDocument["kind"] }) {
  const document = kind === "terms" ? TERMS : PRIVACY;
  const other = kind === "terms" ? { href: "/privacy", label: "Privacy Policy" } : { href: "/terms", label: "Terms of Service" };
  const pending = legalPlaceholders(document);
  return <main className="marketing-page legal-page"><MarketingHeader />
    <div className="legal-document" role="document" aria-labelledby="legal-title">
      {pending.length ? <div className="legal-draft" role="note">
        <strong>Draft pending legal review.</strong> {pending.length} highlighted details are still missing.
      </div> : null}
      <Heading as="h1" id="legal-title">{document.title}</Heading>
      <Text className="legal-updated">Last updated: {withPlaceholders(document.updated)}</Text>
      <Text className="legal-intro">{document.intro}</Text>
      <nav className="legal-toc" aria-label="Contents">
        <ol>{document.sections.map(section => <li key={section.id}><Link href={`#${section.id}`}>{section.heading}</Link></li>)}</ol>
      </nav>
      {document.sections.map(section => <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
        <Heading as="h2" id={`${section.id}-title`}>{section.heading}</Heading>
        {section.paragraphs?.map(paragraph => <Text key={paragraph}>{withPlaceholders(paragraph)}</Text>)}
        {section.list ? <ul>{section.list.map(item => <li key={item}>{withPlaceholders(item)}</li>)}</ul> : null}
      </section>)}
      <Text className="legal-related">See also our <Link href={other.href}>{other.label}</Link>.</Text>
    </div>
    <MarketingFooter />
  </main>;
}
