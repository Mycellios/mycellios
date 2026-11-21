/// <reference lib="dom" />
import { MARKETING_COMPARISONS, MARKETING_INDEXABLE_PATHS } from "../../src/contracts/marketing-pages.js";
import { MARKETING_GUIDES, GUIDE_INDEXES } from "../../src/contracts/marketing-guides.js";
import { comparisons } from "./rebrand/comparison-data.js";

const SITE_ORIGIN = "https://www.mycellios.com";
const BRAND_IMAGE_URL = `${SITE_ORIGIN}/assets/brand/og-network-v2.png`;
const BRAND_LOGO_URL = `${SITE_ORIGIN}/assets/brand/app-icon.png`;
const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
const WEBSITE_ID = `${SITE_ORIGIN}/#website`;
const SOFTWARE_ID = `${SITE_ORIGIN}/#software`;

type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SeoPage {
  title: string;
  description: string;
  canonicalPath: string;
  language?: "en" | "es";
  alternatePath?: string;
  robots: "index, follow, max-image-preview:large" | "noindex, nofollow, noarchive";
  structuredData?: JsonValue;
  staticContent?: {
    heading: string;
    paragraphs: readonly string[];
    sections?: readonly { title: string; paragraphs: readonly string[] }[];
    links: readonly { href: string; label: string }[];
  };
}

const organization = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: "mycellios",
  url: `${SITE_ORIGIN}/`,
  slogan: "Distributed intelligence, rooted in nature.",
  logo: {
    "@type": "ImageObject",
    url: BRAND_LOGO_URL,
  },
  email: "hello@mycellios.com",
  sameAs: ["https://github.com/Mycellios/mycellios", "https://x.com/mycellios", "https://t.me/mycellios"],
};

const website = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  url: `${SITE_ORIGIN}/`,
  name: "mycellios",
  publisher: { "@id": ORGANIZATION_ID },
};

const softwareApplication = {
  "@type": "SoftwareApplication",
  "@id": SOFTWARE_ID,
  name: "mycellios",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Windows, macOS, Linux, Android, Web browser",
  description:
    "An AI agent workspace with supported model connections and an optional distributed compute network. Availability depends on the selected provider, device and permissions.",
  url: `${SITE_ORIGIN}/`,
  publisher: { "@id": ORGANIZATION_ID },
};

function webPage(name: string, description: string, path: string, language = "en"): JsonValue {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description,
    inLanguage: language,
    url: new URL(path, SITE_ORIGIN).href,
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": SOFTWARE_ID },
  };
}

// Build shared metadata once instead of shipping repeated descriptions and fallbacks.
const extraPage = (title: string, description: string, path: string, staticContent: SeoPage["staticContent"] = { heading: title, paragraphs: [description, "Review the linked product sources and implementation status before choosing a workflow. Mycellios is in active development; model and tool availability depend on the current configuration."], links: [{ href: "/", label: "Mycellios" }, { href: "https://www.mycellios.com/agent", label: "Open Agent" }] }): SeoPage => ({ title, description, canonicalPath: path, robots: "index, follow, max-image-preview:large", structuredData: webPage(title, description, path), staticContent });
const privatePage = (title: string, description: string, canonicalPath: string, heading: string): SeoPage => ({ title, description, canonicalPath, robots: "noindex, nofollow, noarchive", staticContent: { heading, paragraphs: [description], links: [{ href: "/", label: "Return to Mycellios" }] } });
type ComparisonSeoPath = `/compare/${(typeof MARKETING_COMPARISONS)[number][0]}`;
const comparisonPages = Object.fromEntries(MARKETING_COMPARISONS.map(([slug, name]) => {
  const item = comparisons.find(entry => entry.slug === slug);
  return [`/compare/${slug}`, extraPage(slug === "best-ai-agent-apps" ? "Choose your next AI agent | Mycellios" : `Mycellios vs ${name}`, `Compare agent workflows, deployment and costs. Original guidance with links to ${name}'s product sources.`, `/compare/${slug}`, item ? {
    heading: `Mycellios vs ${name}`,
    paragraphs: [item.summary, "Mycellios brings Micos, project context and supported model connections into one workspace. Its optional compute network is a separate contribution workflow."],
    sections: [{ title: `Where ${name} fits`, paragraphs: [item.focus, item.setup, item.fit] }, { title: "What to check before choosing", paragraphs: [item.question, "Use the same small task in each app. Review its output, permissions, hosting needs and model usage costs. Product plans and availability can change; check the official source."] }],
    links: [{ href: item.source, label: `${name}: official product source` }, { href: "/guides/models-and-credits", label: "Mycellios models and costs" }, { href: "/compare", label: "All comparisons" }],
  } : { heading: "Choose your next AI agent", paragraphs: ["Start with a small, real task and a result you can verify.", "Compare model choice, deployment, permissions, total cost and the work you can export."], links: comparisons.map(entry => ({ href: `/compare/${entry.slug}`, label: `Mycellios vs ${entry.name}` })) })];
})) as Record<ComparisonSeoPath, SeoPage>;
const comparisonPaths = Object.keys(comparisonPages) as ComparisonSeoPath[];

const guidePages = Object.fromEntries([...GUIDE_INDEXES, ...MARKETING_GUIDES].map(guide => {
  const entries = MARKETING_GUIDES.filter(entry => entry.language === guide.language);
  const page = extraPage(`${guide.title} | Mycellios`, guide.description, guide.path, {
    heading: guide.title, paragraphs: [guide.description, guide.language === "es" ? "Elige una guía y comprueba los requisitos de tu conexión. La disponibilidad de modelos y herramientas puede variar." : "Choose a guide and check the requirements of your connection. Model and tool availability can vary."],
    ...("sections" in guide ? { sections: guide.sections } : {}),
    links: [...entries.filter(entry => entry.path !== guide.path).map(entry => ({ href: entry.path, label: entry.title })), { href: "https://www.mycellios.com/agent", label: guide.language === "es" ? "Abrir Mycellios" : "Open Mycellios" }, { href: "/downloads/desktop", label: guide.language === "es" ? "Descargar la aplicación" : "Download the app" }],
  });
  return [guide.path, { ...page, language: guide.language, alternatePath: guide.alternate, structuredData: { "@context": "https://schema.org", "@graph": [webPage(guide.title, guide.description, guide.path, guide.language), { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Mycellios", item: `${SITE_ORIGIN}/` }, { "@type": "ListItem", position: 2, name: guide.title, item: new URL(guide.path, SITE_ORIGIN).href }] }] } }];
})) as Record<string, SeoPage>;

const basePages = {
  ...guidePages,
  // Draft legal pages stay out of search results until legal review.
  "/terms": privatePage("Terms of Service | Mycellios", "The terms that govern your use of Mycellios.", "/terms", "Terms of Service"),
  "/privacy": privatePage("Privacy Policy | Mycellios", "How Mycellios processes your personal data and the choices you have.", "/privacy", "Privacy Policy"),
  ...comparisonPages,
  "/pricing": extraPage("AI Credits, costs & pricing | Mycellios", "Understand Mycellios Credits and optional model providers. Estimate your own provider and hosting costs, and check current model prices before use.", "/pricing", { heading: "Understand your AI costs", paragraphs: ["Mycellios supports your own model connections and an optional managed provider using Credits. One Credit corresponds to one USD for paid top-ups. Managed pricing includes the complete upstream cost plus a 4% Mycellios service fee.", "The provider-cost calculator is a separate estimate from your own inputs, not a live model quote or a subscription purchase. Check your wallet and the chosen model's price before paid work."], links: [{ href: "/guides/models-and-credits", label: "How models and Credits work" }, { href: "/guides/contribute-compute", label: "Earn Credits from verified work" }] }),
  "/compare": extraPage("Compare AI agent apps | Mycellios", "Compare Mycellios with other agent apps, with original guidance and current product sources.", "/compare", { heading: "Find your kind of agent", paragraphs: ["Explore workspaces, personal assistants and coding agents.", "Compare how they run, what they connect to and how you pay. Start with your own task rather than a universal ranking."], links: MARKETING_COMPARISONS.map(([slug, name]) => ({ href: `/compare/${slug}`, label: slug === "best-ai-agent-apps" ? name : `Mycellios vs ${name}` })) }),
  "/stats": extraPage("Mycellios Stats — network observations", "Inspect observed node capacity, models, jobs and persisted history from Mycellios's public coordinator.", "/stats"),
  "/changelog": extraPage("Changelog & release notes | Mycellios", "Follow Mycellios Desktop and Agent updates, with dated release notes, improvements, fixes and links to the original publications.", "/changelog", { heading: "What’s new in Mycellios.", paragraphs: ["Read dated notes for Mycellios Desktop previews and Agent web updates.", "Browse new features, improvements and fixes, with original publication sources and guidance for manual preview updates."], links: [{ href: "/downloads/desktop", label: "Desktop downloads" }, { href: "/blog", label: "Mycellios Journal" }] }),
  "/spore/rewards": { title: "Useful work. Shared rewards. | Mycellios", description: "SPORE rewards, staking and contributor payouts are coming soon. Explore the proposed reward flow and use Mycellios Agent today.", canonicalPath: "/spore/rewards", robots: "noindex, nofollow, noarchive", staticContent: { heading: "Useful work. Shared rewards.", paragraphs: ["SPORE rewards, staking and contributor payouts are coming soon. Confirmed rates and conditions will be published before activation."], links: [{ href: "https://www.mycellios.com/agent", label: "Open Mycellios Agent" }] } },
  "/": {
    title: "Mycellios — AI agents, your models & shared compute",
    description:
      "Work with AI agents in one workspace. Connect your models or use Mycellios Credits, and contribute compatible compute to earn Credits for verified work.",
    canonicalPath: "/",
    robots: "index, follow, max-image-preview:large",
    staticContent: {
      heading: "Meet Mycellios",
      paragraphs: [
        "Mycellios Agent brings AI agents called Micos, conversations, files and supported model connections into one workspace. Open it in a browser or download the desktop app.",
        "Use your own supported provider or the optional Mycellios provider with Credits. Contribute compatible compute to earn Credits only for accepted, independently verified work; availability and earnings are not guaranteed.",
        "The project is under active development. Multi-host GPU performance, models that need combined host memory, and recovery after a worker fails have not been demonstrated as general production capabilities.",
      ],
      links: [
        { href: "https://www.mycellios.com/agent", label: "Open Mycellios Agent" },
        { href: "/network", label: "Inspect the public network snapshot" },
        { href: "/earn", label: "Contribute compute for verified-work Credits" },
        { href: "/guides", label: "Get started with Mycellios" },
        { href: "/es/guias", label: "Guías en español" },
        { href: "/compare", label: "Compare AI agent workspaces" },
        { href: "/downloads/desktop", label: "Download Mycellios Desktop" },
        { href: "https://github.com/Mycellios/mycellios", label: "View the source code" },
      ],
    },
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [organization, website, softwareApplication],
    },
  },
  "/network": extraPage(
    "Live distributed AI network | mycellios",
    "Inspect the public mycellios network snapshot: connected workers, available models, and recorded inference activity when data is available.",
    "/network", {
      heading: "Mycellios public network status",
      paragraphs: [
        "This page reads a public snapshot from the Mycellios coordinator and reports registered or connected workers, available models, and recorded activity when that data is available.",
        "Values are observed or derived from the snapshot. Revenue, rewards, and throughput remain unpublished unless an auditable public source is available.",
      ],
      links: [
        { href: "/", label: "About the Mycellios project" },
        { href: "/blog", label: "Read Mycellios research and field notes" },
      ],
    }),
  "/earn": extraPage(
    "Contribute compute and earn AI Credits | Mycellios",
    "Activate compatible compute from your Mycellios account. Earn AI Credits for approved, independently verified work and pause contribution whenever you choose.",
    "/earn", {
      heading: "Contribute compute to the Mycellios test network",
      paragraphs: [
        "Join the Mycellios test network with a compatible browser worker or native client. You choose what your device shares and can pause it at any time.",
        "Account-bound, approved work can earn AI Credits after independent verification. Connection time and benchmarks do not earn Credits; demand and earnings are not guaranteed. Spore token rewards and cash payouts remain separate, planned features.",
      ],
      links: [
        { href: "https://www.mycellios.com/agent", label: "Open Agent and activate Generate AI" },
        { href: "/guides/contribute-compute", label: "How verified-work Credits work" },
        { href: "/downloads", label: "Check native package availability" },
      ],
    }),
  "/spore": privatePage("$SPORE participation preview | mycellios", "Preview the proposed SPORE participation flow. No token, staking contract, treasury, price feed or reward program is live.", "/spore", "SPORE participation preview"),
  "/downloads": {
    title: "Native package availability | mycellios",
    description:
      "Check which mycellios native packages are published for Windows, macOS, and Linux, or contribute from your browser without installing software.",
    canonicalPath: "/downloads",
    robots: "index, follow, max-image-preview:large",
    staticContent: {
      heading: "Mycellios native package availability",
      paragraphs: [
        "Check published native releases for Windows, macOS, and Linux. Download links appear only for packages found in the public release store.",
        "If a package is unavailable, review the public releases or try the browser worker on a compatible device without installing a native client.",
      ],
      links: [
        { href: "https://www.mycellios.com/agent", label: "Open Agent and activate Generate AI" },
        { href: "/guides/contribute-compute", label: "How verified-work Credits work" },
        { href: "https://github.com/Mycellios/mycellios/releases", label: "View published releases" },
      ],
    },
    structuredData: {
      "@context": "https://schema.org",
      ...softwareApplication,
      url: `${SITE_ORIGIN}/downloads`,
    },
  },
  "/browser/": {
    title: "Browser contribution | Mycellios",
    description:
      "Connect a desktop, tablet, or phone browser to mycellios and contribute voluntary, measurable compute that you can pause anytime.",
    canonicalPath: "/browser/",
    robots: "index, follow, max-image-preview:large",
    staticContent: {
      heading: "Connect a browser to Mycellios",
      paragraphs: [
        "An opt-in worker lets compatible desktop, tablet, or phone browsers contribute measurable compute to the Mycellios test network. You can pause it at any time.",
        "Available tasks depend on browser capabilities and network state. This standalone worker does not attribute earnings to your account. For verified-work Credits, use the account-bound Generate AI control in Mycellios Agent.",
      ],
      links: [
        { href: "/earn", label: "Learn about contributing compute" },
        { href: "/network", label: "Inspect the public network snapshot" },
      ],
    },
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Mycellios Browser Contribution",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any compatible desktop, tablet, or phone browser",
      description:
        "A universal browser worker for voluntarily contributing compatible compute to the mycellios network.",
      url: `${SITE_ORIGIN}/browser/`,
      publisher: { "@id": ORGANIZATION_ID },
    },
  },
  "/admin": privatePage("Network administration | mycellios", "Operational administration for the mycellios network.", "/admin", "Mycellios network administration"),
  "/dashboard": privatePage("Mycellios Stats dashboard", "Inspect Mycellios capacity, model availability and recorded network work.", "/dashboard", "Mycellios dashboard"),
  "/account": privatePage("Account and subscription | mycellios", "Secure account, subscription, billing and usage management for mycellios.", "/account", "Mycellios account and subscription"),
} satisfies Record<string, SeoPage>;

export const SEO_PAGES = basePages as typeof basePages & Record<string, SeoPage>;

export type SeoPath = keyof typeof SEO_PAGES;

export const INDEXABLE_SEO_PATHS = MARKETING_INDEXABLE_PATHS;
export const LANDING_SEO_PATHS = [
  "/",
  "/network",
  "/earn",
  "/spore",
  "/spore/rewards",
  "/stats",
  "/pricing",
  "/changelog",
  "/compare",
  ...comparisonPaths,
  ...Object.keys(guidePages),
  "/downloads",
  "/admin",
  "/dashboard",
  "/account",
  "/terms",
  "/privacy",
] as const;

export function canonicalUrl(page: SeoPage): string {
  return new URL(page.canonicalPath, SITE_ORIGIN).href;
}

export function seoLanguageLinks(page: SeoPage): { language: string; href: string }[] {
  if (!page.alternatePath) return [];
  const englishPath = page.language === "es" ? page.alternatePath : page.canonicalPath;
  return [
    { language: page.language ?? "en", href: canonicalUrl(page) },
    { language: page.language === "es" ? "en" : "es", href: new URL(page.alternatePath, SITE_ORIGIN).href },
    { language: "x-default", href: new URL(englishPath, SITE_ORIGIN).href },
  ];
}

export function seoMarkdownPath(page: SeoPage): string {
  return page.canonicalPath === "/" ? "/index.md" : `${page.canonicalPath.replace(/\/+$/, "")}.md`;
}

export function seoPageForPath(pathname: string, search = ""): SeoPage {
  pathname = pathname.length > 1 && !pathname.startsWith("/browser") ? pathname.replace(/\/+$/, "") : pathname;
  if (["/network", "/downloads", "/browser", "/browser/"].includes(pathname) && new URLSearchParams(search).has("view")) return privatePage("Mycellios network console", "Private operational view of the Mycellios network.", pathname, "Mycellios console");
  if (pathname === "/dashboard" && new URLSearchParams(search).has("view")) return {
    ...SEO_PAGES["/dashboard"],
    title: "Mycellios network console",
    description: "Inspect network capacity, models, devices and operational evidence in the Mycellios console.",
  };
  if (pathname === "/browser" || pathname.startsWith("/browser/") || pathname === "/mobile" || pathname.startsWith("/mobile/")) return SEO_PAGES["/browser/"];
  if (pathname in SEO_PAGES) return SEO_PAGES[pathname as SeoPath]!;
  return privatePage("Page not found | Mycellios", "This page is not available. Explore Mycellios guides or return to the homepage.", pathname, "Page not found");
}

function upsertMeta(attribute: "name" | "property", key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

function upsertCanonical(href: string): void {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.append(element);
  }
  element.href = href;
}

function upsertStructuredData(data: JsonValue | undefined): void {
  const existing = document.head.querySelector<HTMLScriptElement>("#seo-structured-data");
  if (!data) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("script");
  element.id = "seo-structured-data";
  element.type = "application/ld+json";
  element.textContent = JSON.stringify(data);
  if (!existing) document.head.append(element);
}

export function applySeoMetadata(pathname = window.location.pathname): void {
  const page = seoPageForPath(["stats.mycellios.com", "stats.localhost"].includes(window.location.hostname) && pathname === "/" ? "/stats" : pathname, window.location.search);
  const url = canonicalUrl(page);

  document.documentElement.lang = page.language ?? "en";
  document.title = page.title;
  upsertMeta("name", "description", page.description);
  upsertMeta("name", "robots", page.robots);
  upsertMeta("property", "og:type", "website");
  upsertMeta("property", "og:site_name", "mycellios");
  upsertMeta("property", "og:locale", page.language === "es" ? "es_ES" : "en_US");
  upsertMeta("property", "og:url", url);
  upsertMeta("property", "og:title", page.title);
  upsertMeta("property", "og:description", page.description);
  upsertMeta("property", "og:image", BRAND_IMAGE_URL);
  upsertMeta("property", "og:image:alt", "Mycellios — many machines, one shared network");
  upsertMeta("property", "og:image:width", "1200");
  upsertMeta("property", "og:image:height", "630");
  upsertMeta("property", "og:image:type", "image/png");
  upsertMeta("name", "twitter:image:alt", "Mycellios — many machines, one shared network");
  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", page.title);
  upsertMeta("name", "twitter:description", page.description);
  upsertMeta("name", "twitter:image", BRAND_IMAGE_URL);
  upsertCanonical(url);
  document.head.querySelectorAll('link[data-seo-alternate]').forEach(link => link.remove());
  for (const item of seoLanguageLinks(page)) {
    const link = document.createElement("link");
    link.rel = "alternate"; link.hreflang = item.language; link.href = item.href;
    link.dataset.seoAlternate = "language"; document.head.append(link);
  }
  if (page.robots.startsWith("index")) {
    const link = document.createElement("link");
    link.rel = "alternate"; link.type = "text/markdown";
    link.href = new URL(seoMarkdownPath(page), SITE_ORIGIN).href;
    link.dataset.seoAlternate = "markdown"; document.head.append(link);
  }
  upsertStructuredData(page.structuredData);
}
