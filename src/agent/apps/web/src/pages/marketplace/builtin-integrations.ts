import type { ConnectionCatalogItem, McpServer } from "@rakazo/contracts";
export type BuiltinIntegration = { slug: string; name: string; endpoint: string; logo: string; auth: "oauth" | "key" };
// Public provider metadata from OpenBot's plugin catalog (2026-11-10).
// https://github.com/nightly-labs/openbot/tree/main/marketplace/plugin-catalog
// GitHub and remote Figma use their vendors' documented endpoints.
export const BUILTIN_INTEGRATIONS: readonly BuiltinIntegration[] = [
  {
    "slug": "canva",
    "name": "Canva",
    "endpoint": "https://mcp.canva.com/mcp",
    "logo": "https://static.canva.com/static/images/apple-touch-icon-180x180.png",
    "auth": "oauth"
  },
  {
    "slug": "linear",
    "name": "Linear",
    "endpoint": "https://mcp.linear.app/mcp",
    "logo": "https://linear.app/favicon.ico",
    "auth": "oauth"
  },
  {
    "slug": "notion",
    "name": "Notion",
    "endpoint": "https://mcp.notion.com/mcp",
    "logo": "https://www.notion.so/images/favicon.ico",
    "auth": "oauth"
  },
  {
    "slug": "atlassian",
    "name": "Atlassian",
    "endpoint": "https://mcp.atlassian.com/v2/mcp",
    "logo": "https://www.atlassian.com/favicon.ico",
    "auth": "oauth"
  },
  {
    "slug": "todoist",
    "name": "Todoist",
    "endpoint": "https://ai.todoist.net/mcp",
    "logo": "https://www.todoist.com/static/apple-touch-icon.png",
    "auth": "oauth"
  },
  {
    "slug": "trello",
    "name": "Trello",
    "endpoint": "https://mcp.trello.com/v1",
    "logo": "https://trello.com/favicon.ico",
    "auth": "oauth"
  },
  {
    "slug": "sentry",
    "name": "Sentry",
    "endpoint": "https://mcp.sentry.dev/mcp",
    "logo": "https://sentry.io/favicon.ico",
    "auth": "oauth"
  },
  {
    "slug": "gitlab",
    "name": "GitLab",
    "endpoint": "https://gitlab.com/api/v4/mcp",
    "logo": "https://gitlab.com/favicon.ico",
    "auth": "oauth"
  },
  {
    "slug": "vercel",
    "name": "Vercel",
    "endpoint": "https://mcp.vercel.com",
    "logo": "https://vercel.com/favicon.ico",
    "auth": "oauth"
  },
  {
    "slug": "cloudflare",
    "name": "Cloudflare",
    "endpoint": "https://mcp.cloudflare.com/mcp",
    "logo": "https://developers.cloudflare.com/favicon.png",
    "auth": "oauth"
  },
  {
    "slug": "supabase",
    "name": "Supabase",
    "endpoint": "https://mcp.supabase.com/mcp",
    "logo": "https://supabase.com/favicon/favicon.ico",
    "auth": "oauth"
  },
  {
    "slug": "neon",
    "name": "Neon",
    "endpoint": "https://mcp.neon.tech/mcp",
    "logo": "https://neon.com/apple-touch-icon.png",
    "auth": "oauth"
  },
  {
    "slug": "prisma",
    "name": "Prisma",
    "endpoint": "https://mcp.prisma.io/mcp",
    "logo": "https://www.prisma.io/apple-icon.png",
    "auth": "oauth"
  },
  {
    "slug": "netlify",
    "name": "Netlify",
    "endpoint": "https://netlify-mcp.netlify.app/mcp",
    "logo": "https://www.netlify.com/favicon/apple-touch-icon.png",
    "auth": "oauth"
  },
  {
    "slug": "railway",
    "name": "Railway",
    "endpoint": "https://mcp.railway.com",
    "logo": "https://railway.com/apple-touch-icon.png",
    "auth": "oauth"
  },
  {
    "slug": "clickup",
    "name": "ClickUp",
    "endpoint": "https://mcp.clickup.com/mcp",
    "logo": "https://clickup.com/favicons/apple-touch-icon.png",
    "auth": "oauth"
  },
  {
    "slug": "github",
    "name": "GitHub",
    "endpoint": "https://api.githubcopilot.com/mcp/",
    "logo": "https://github.githubassets.com/favicons/favicon.svg",
    "auth": "key"
  },
  {
    "slug": "render",
    "name": "Render",
    "endpoint": "https://mcp.render.com/mcp",
    "logo": "https://dashboard.render.com/favicon-light.png",
    "auth": "key"
  },
  {
    "slug": "figma",
    "name": "Figma",
    "endpoint": "https://mcp.figma.com/mcp",
    "logo": "https://static.figma.com/app/icon/1/favicon.ico",
    "auth": "oauth"
  }
];
export const BUILTIN_CONNECTOR = "builtin-mcp";
export function integrationCatalog(managed: ConnectionCatalogItem[], servers: McpServer[]): ConnectionCatalogItem[] {
  const slugs = new Set(managed.map(item => item.slug.toLowerCase()));
  return [...managed, ...BUILTIN_INTEGRATIONS.filter(app => !slugs.has(app.slug)).map(app => ({
    connectorId: BUILTIN_CONNECTOR, noAuth: false, slug: app.slug, name: app.name, logo: app.logo,
    connected: servers.some(server => server.endpoint === app.endpoint && server.enabled && server.health.status === "ok" && (server.oauthStatus === "connected" || (app.auth === "key" && server.hasSecret))),
  }))];
}
