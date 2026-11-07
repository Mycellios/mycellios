export const CATEGORIES = ["code", "design", "data", "documents", "productivity", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export type MarketplaceTab = "apps" | "agents" | "skills" | "mycellios-apps";
export function marketplaceTab(value: string | null): MarketplaceTab {
  return value === "agents" || value === "skills" || value === "mycellios-apps" ? value : "apps";
}
export function matches(query: string, ...values: string[]) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  return normalize(values.join(" ")).includes(normalize(query.trim()));
}
const APP_GROUPS: Record<string, Category> = {
  github: "code",
  linear: "code",
  sentry: "code",
  vercel: "code",
  cloudflare: "code",
  supabase: "code",
  neon: "code",
  prisma: "code",
  netlify: "code",
  railway: "code",
  render: "code",
  jira: "code",
  firecrawl: "code",
  canva: "design",
  figma: "design",
  paper: "design",
  aave: "data",
  posthog: "data",
  airtable: "data",
  googlesheets: "data",
  serpapi: "data",
  googledocs: "documents",
  googledrive: "documents",
  notion: "documents",
  obsidian: "documents",
  gmail: "productivity",
  googlecalendar: "productivity",
  slack: "productivity",
  discord: "productivity",
  telegram: "productivity",
  whatsapp: "productivity",
  outlook: "productivity",
  twitter: "productivity",
  hubspot: "productivity",
  composio: "productivity",
  "1password": "productivity",
  bitwarden: "productivity",
};
export function appCategory(slug: string): Category {
  const key = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.hasOwn(APP_GROUPS, key) ? APP_GROUPS[key]! : "other";
}
const APP_DESCRIPTIONS: Record<string, string> = {
  github: "Repositorios y seguimiento de cambios",
  linear: "Proyectos y seguimiento de incidencias",
  sentry: "Diagnóstico de errores de aplicaciones",
  vercel: "Proyectos y despliegues web",
  cloudflare: "Servicios web, dominios y almacenamiento",
  supabase: "Proyectos, datos y servicios de backend",
  neon: "Proyectos y bases de datos Postgres",
  prisma: "Bases de datos y administración de proyectos",
  netlify: "Sitios web y despliegues",
  railway: "Proyectos, servicios y despliegues",
  render: "Servicios y despliegues de aplicaciones",
  jira: "Proyectos, incidencias y tareas",
  canva: "Diseños y recursos de contenido",
  figma: "Archivos de diseño y prototipos",
  paper: "Diseño de interfaces",
  airtable: "Bases de datos, tablas y registros",
  posthog: "Análisis de producto y eventos",
  googlesheets: "Hojas de cálculo y datos",
  serpapi: "Resultados de búsquedas",
  gmail: "Correo y conversaciones de Gmail",
  googlecalendar: "Calendarios, eventos y disponibilidad",
  googledrive: "Archivos y documentos de Drive",
  googledocs: "Documentos de Google",
  slack: "Conversaciones y espacios de trabajo",
  notion: "Páginas y bases de conocimiento",
  outlook: "Correo y calendario de Microsoft",
  twitter: "Contenido y cuenta de X",
  hubspot: "Contactos y procesos comerciales",
  discord: "Comunidades y conversaciones",
  telegram: "Chats y grupos",
  whatsapp: "Conversaciones de WhatsApp",
  firecrawl: "Extracción de contenido web",
  composio: "Catálogo de herramientas y conexiones",
};
export function appDescription(slug: string) {
  const key = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.hasOwn(APP_DESCRIPTIONS, key) ? APP_DESCRIPTIONS[key]! : "";
}
export function groupByCategory<T>(items: readonly T[], category: (item: T) => Category) {
  return CATEGORIES.map((id) => ({
    id,
    items: items.filter((item) => category(item) === id),
  })).filter((group) => group.items.length > 0);
}

export type Recipe = {
  id: string;
  name: string;
  category: Category;
  description: string;
  body: string;
};
// Authored Mycellios recipes. Installing one saves an ordinary shared SKILL.md;
// nothing here grants tools, credentials, permissions or automatic execution.
export const SKILL_RECIPES: Recipe[] = [
  {
    id: "change-review",
    name: "Change Review",
    category: "code",
    description: "Revisa cambios de código y comprueba posibles regresiones.",
    body: "Read the requested diff and surrounding callers. Verify concrete failure scenarios before reporting them. Rank confirmed issues by impact, include locations and explain missing coverage. Return the review in this conversation; do not edit, approve or publish changes without an explicit request.",
  },
  {
    id: "bug-triage",
    name: "Bug Triage",
    category: "code",
    description: "Convierte un fallo reproducible en un diagnóstico y un plan de corrección.",
    body: "Establish expected and actual behavior. Reproduce with the smallest relevant case, inspect errors and owning code, distinguish evidence from hypotheses, and propose a bounded fix with a regression check. Preserve unrelated work and disclose anything not reproduced.",
  },
  {
    id: "acceptance-check",
    name: "Acceptance Check",
    category: "code",
    description: "Comprueba una aplicación contra criterios de aceptación concretos.",
    body: "Identify the requested acceptance criteria and authorized environment. Exercise each relevant user flow, including error recovery and keyboard access. Record observed outcomes and screenshots when possible. Do not call an untested step passed; never use production writes or external communications as test fixtures.",
  },
  {
    id: "security-review",
    name: "Security Review",
    category: "code",
    description: "Revisa permisos, límites de confianza y exposición de datos.",
    body: "Map entry points, sensitive data and trust boundaries in the supplied code. Check ownership, validation, secret handling and unsafe effects. Report only substantiated findings with reproduction conditions and proportionate remediation. Do not exploit live systems, weaken protections or expose secrets.",
  },
  {
    id: "interface-critique",
    name: "Interface Critique",
    category: "design",
    description: "Revisa jerarquía, legibilidad y estados de una interfaz.",
    body: "Inspect the actual interface and its design system. Review hierarchy, spacing, contrast, copy, keyboard navigation, responsive layout and loading/error/empty states. Prioritize concrete defects affecting the user's task. Preserve the requested visual direction and propose specific changes.",
  },
  {
    id: "prototype-build",
    name: "Prototype Build",
    category: "design",
    description: "Construye un prototipo utilizable con componentes del proyecto.",
    body: "Identify the main user flow and existing components. Implement the smallest useful interactive version in the current stack, preserving product facts and permissions. Use real handlers where available and clearly identify fixtures. Inspect the rendered result on desktop and mobile and verify keyboard behavior.",
  },
  {
    id: "build-spec",
    name: "Build Spec",
    category: "design",
    description: "Transforma una referencia en una especificación de implementación.",
    body: "Read the supplied reference and existing product. Describe layout, components, data sources, actions, responsive behavior and accessibility states. Identify reuse and integration boundaries, acceptance criteria and unresolved decisions. Do not invent capabilities or factual copy.",
  },
  {
    id: "accessibility-audit",
    name: "Accessibility Audit",
    category: "design",
    description: "Comprueba navegación con teclado, foco, etiquetas y contraste.",
    body: "Inspect the rendered page with keyboard and available accessibility tools. Check names, roles, order, focus visibility/return, dialogs, forms, error announcements, zoom and contrast. Report observed barriers with affected flow and a concrete repair. Separate automated findings from manual acceptance.",
  },
  {
    id: "alt-text",
    name: "Alt Text",
    category: "design",
    description: "Redacta textos alternativos según la función de cada imagen.",
    body: "Inspect each supplied image in its page context. Write concise alternative text conveying its function or essential content, avoid redundant introductions and unnecessary visual detail, and use empty alternatives for purely decorative images. Do not infer identities or unsupported facts.",
  },
  {
    id: "data-quality",
    name: "Data Quality Review",
    category: "data",
    description: "Revisa datos ausentes, duplicados y reglas de consistencia.",
    body: "Identify the dataset, schema, units and intended analysis. Check missing values, duplicates, ranges, joins and consistency with bounded read-only queries. Quantify the inspected scope, retain raw data and distinguish missing measurements from zero. Do not silently change records.",
  },
  {
    id: "campaign-analysis",
    name: "Campaign Analysis",
    category: "data",
    description: "Explica resultados de campañas usando métricas y periodos comparables.",
    body: "Establish the campaign goal, measurement source, time zone, period and attribution limits. Compare equivalent cohorts and calculate relevant rates with denominators. Separate observations from causal hypotheses and disclose missing costs or outcomes. Propose a small measurable next step.",
  },
  {
    id: "spend-audit",
    name: "Spend Audit",
    category: "data",
    description: "Organiza gastos y detecta duplicidades sin modificar suscripciones.",
    body: "Inventory the authorized expense records, currencies, periods and owners. Distinguish recorded charges, estimates and unavailable values. Identify possible duplicates or unused services with evidence and preserve billing sources. Recommend actions; do not cancel, purchase or change a subscription without authorization.",
  },
  {
    id: "launch-notes",
    name: "Launch Notes",
    category: "documents",
    description: "Prepara notas de una entrega a partir de cambios comprobados.",
    body: "Read the actual delivered changes and their verification. Explain user-visible behavior first, group related changes and describe remaining limitations precisely. Distinguish local preparation, publication and production deployment. Exclude secrets, internal speculation and unsupported completion claims.",
  },
  {
    id: "support-reply",
    name: "Support Reply",
    category: "documents",
    description: "Redacta una respuesta de soporte clara y accionable.",
    body: "Read the customer's issue and known evidence. Explain the current outcome in plain language, provide the next practical step and ask only for missing information that changes the diagnosis. Do not invent fixes or promises. Return a draft; do not send it without authorization.",
  },
  {
    id: "voice-edit",
    name: "Voice Edit",
    category: "documents",
    description: "Edita un borrador para hacerlo breve, natural y claro.",
    body: "Preserve the author's facts, intent and tone. Lead with the main point, remove repetition and vague phrasing, use concrete verbs and connected paragraphs, and retain meaningful qualifications. Return the revised draft and flag only unresolved factual ambiguities.",
  },
  {
    id: "search-brief",
    name: "Search Content Brief",
    category: "documents",
    description: "Prepara una guía de contenido con fuentes y preguntas del público.",
    body: "Establish the audience, search intent and authorized source material. Research current primary sources where needed. Produce an outline, key questions and supported facts with sources. Distinguish proposals from measured keyword or traffic data, and do not invent search volumes.",
  },
];
export function recipeContent(recipe: Recipe) {
  return `---\nname: ${recipe.name}\ndescription: ${recipe.description}\n---\n\n${recipe.body}\n`;
}
export const MICO_TEMPLATES = [
  {
    id: "research-desk",
    name: "Research Desk",
    category: "documents" as Category,
    description: "Investiga una pregunta y entrega conclusiones con fuentes.",
    skills: ["data-quality", "search-brief"],
  },
  {
    id: "change-reviewer",
    name: "Change Reviewer",
    category: "code" as Category,
    description: "Revisa cambios, riesgos y pruebas antes de una entrega.",
    skills: ["change-review", "security-review"],
  },
  {
    id: "scope-writer",
    name: "Scope Writer",
    category: "design" as Category,
    description: "Convierte una idea en un alcance y criterios de aceptación.",
    skills: ["build-spec", "voice-edit"],
  },
  {
    id: "bug-fixer",
    name: "Bug Fixer",
    category: "code" as Category,
    description: "Reproduce un fallo, corrige su causa y verifica el resultado.",
    skills: ["bug-triage", "acceptance-check"],
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    category: "code" as Category,
    description: "Analiza permisos, datos y límites de confianza.",
    skills: ["security-review"],
  },
  {
    id: "qa-tester",
    name: "QA Tester",
    category: "code" as Category,
    description: "Comprueba flujos reales y documenta los fallos observados.",
    skills: ["acceptance-check", "accessibility-audit"],
  },
  {
    id: "design-critic",
    name: "Design Critic",
    category: "design" as Category,
    description: "Propone mejoras concretas de jerarquía y usabilidad.",
    skills: ["interface-critique", "accessibility-audit"],
  },
  {
    id: "prototype-builder",
    name: "Prototype Builder",
    category: "design" as Category,
    description: "Construye y revisa un prototipo funcional de una idea.",
    skills: ["prototype-build", "build-spec"],
  },
  {
    id: "campaign-analyst",
    name: "Campaign Analyst",
    category: "data" as Category,
    description: "Analiza campañas con datos, periodos y límites claros.",
    skills: ["campaign-analysis", "data-quality"],
  },
  {
    id: "spend-auditor",
    name: "Spend Auditor",
    category: "data" as Category,
    description: "Organiza gastos y señala duplicidades con evidencias.",
    skills: ["spend-audit"],
  },
  {
    id: "support-desk",
    name: "Support Reply Desk",
    category: "documents" as Category,
    description: "Prepara respuestas de soporte claras y revisables.",
    skills: ["support-reply", "voice-edit"],
  },
  {
    id: "copy-editor",
    name: "Copy Editor",
    category: "documents" as Category,
    description: "Edita borradores manteniendo los hechos y tu tono.",
    skills: ["voice-edit", "launch-notes"],
  },
];
export function templateInstructions(template: (typeof MICO_TEMPLATES)[number]) {
  return `${template.description}\n\nWork within the user's requested scope and existing permissions. Preserve unrelated work and distinguish facts, hypotheses and unverified outcomes. Do not send messages, publish, spend, delete or expand permissions without the user's authorization.\n\n${template.skills.map((id) => SKILL_RECIPES.find((skill) => skill.id === id)?.body ?? "").join("\n\n")}`;
}

export function appPriority(slug: string) {
  const index = Object.keys(APP_GROUPS).indexOf(slug.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return index < 0 ? 10000 : index;
}
