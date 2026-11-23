import { ArrowUpRight } from "lucide-react";
import { GUIDE_INDEXES, MARKETING_GUIDES } from "../../../src/contracts/marketing-guides";
import { seoPageForPath } from "../seo";
import { Heading, Link, Text } from "../ui/primitives";
import { MarketingHeader, MarketingFooter } from "./MarketingHeader";
import "./guide-page.css";

export function GuidePage() {
  const path = window.location.pathname.replace(/\/+$/, "");
  const page = seoPageForPath(path);
  const content = page.staticContent!;
  const spanish = page.language === "es";
  const guide = MARKETING_GUIDES.find(entry => entry.path === path);
  const index = GUIDE_INDEXES.find(entry => entry.language === page.language)!;
  return <main className="marketing-page guide-page"><MarketingHeader />
    <div className="marketing-shell guide-article" lang={page.language}>
      <nav className="guide-navigation" aria-label={spanish ? "Navegación de guías" : "Guide navigation"}>
        {guide && <Link href={index.path}>{index.title}</Link>}
        <Link className="guide-language" href={page.alternatePath!} lang={spanish ? "en" : "es"} hrefLang={spanish ? "en" : "es"}>{spanish ? "Read in English" : "Leer en español"}</Link>
      </nav>
      <Heading as="h1">{content.heading}</Heading>
      <Text className="guide-description">{content.paragraphs[0]}</Text>
      <Text className="guide-lead">{content.paragraphs[1]}</Text>
      {content.sections?.map(section => <section key={section.title}><Heading as="h2">{section.title}</Heading>{section.paragraphs.map(paragraph => <Text key={paragraph}>{paragraph}</Text>)}</section>)}
      <nav className="guide-related" aria-label={spanish ? "Más recursos" : "Related resources"}>
        <Heading as="h2">{spanish ? "Continúa por aquí" : "Keep exploring"}</Heading>
        {content.links.map(link => <Link key={link.href} href={link.href}>{link.label}<ArrowUpRight size={15} aria-hidden="true" /></Link>)}
        <Link href="https://github.com/Mycellios/mycellios/blob/main/docs/STATUS_AND_EVIDENCE.md">{spanish ? "Estado y evidencias del proyecto" : "Project status and evidence"}<ArrowUpRight size={15} aria-hidden="true" /></Link>
      </nav>
    </div><MarketingFooter />
  </main>;
}
