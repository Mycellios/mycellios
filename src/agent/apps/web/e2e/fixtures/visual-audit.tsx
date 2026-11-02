import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TooltipProvider,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  OptionSelect,
} from "@rakazo/ui-web";
import { AuthFrame } from "../../src/pages/Auth";
import { AskCard } from "../../src/components/AskCard";
import { ArtifactFileCard } from "../../src/components/ArtifactFileCard";
import { setDeveloperMode } from "../../src/lib/developer-mode";
import { setUiAppearance } from "../../src/lib/ui-appearance";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { LanguageEntry } from "../../src/components/LanguageEntry";
import { MemoryRouter } from "react-router-dom";
import { SettingsOverlay } from "../../src/pages/SettingsOverlay";
import { PluginsOverlay } from "../../src/pages/PluginsOverlay";
import { QueryUserProvider } from "../../src/lib/query";
import { i18n, bootstrapI18n } from "../../src/lib/i18n";
import "../../src/styles.css";
import type { SettingsSection } from "../../src/pages/shell-overlay";
const p = new URLSearchParams(location.search);
await bootstrapI18n(p.get("locale") === "es" ? "es" : p.get("locale") === "de" ? "de" : "en");
setUiAppearance(p.get("theme") === "dark" ? "dark" : "light");
if (p.get("section") === "logs") setDeveloperMode("fixture-user", true);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const [section, setSection] = useState<SettingsSection>(
    (p.get("section") ?? "general") as SettingsSection,
  );
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("long");
  if (p.get("surface") === "cards")
    return (
      <main className="space-y-5 p-6">
        <AskCard
          canAnswer
          canDismiss
          onAnswer={async () => {}}
          onDismiss={async () => {}}
          block={
            {
              kind: "ask",
              text: "Which dates do you have in mind?",
              input: "choice",
              status: "pending",
              actions: [
                { id: "specific", label: "I have specific dates" },
                { id: "flexible", label: "Flexible dates, find the least expensive option" },
              ],
            } as any
          }
        />
        <AskCard
          canAnswer
          canDismiss
          onAnswer={async () => {}}
          onDismiss={async () => {}}
          block={
            {
              kind: "ask",
              text: "Connect your account",
              input: "secret",
              purpose: "api_key",
              status: "pending",
              credential: {
                name: "Research-and-development-account-with-a-long-name",
                origin:
                  "https://example.test/very-long-credential-origin-with-no-useful-line-break",
                auth: { type: "bearer" },
              },
            } as any
          }
        />
        <ArtifactFileCard
          target={{ kind: "bot", botId: "fixture-bot" } as any}
          artifactId="fixture-artifact"
          name="Mycellios-research-and-development-long-file-name-report.pdf"
          mimeType="application/pdf"
          size={123456}
        />
        <ArtifactFileCard
          target={{ kind: "bot", botId: "fixture-bot" } as any}
          artifactId="fixture-zip"
          name="Mycellios-research-and-development-long-file-name-report.zip"
          mimeType="application/zip"
          size={123456}
        />
      </main>
    );
  if (p.get("surface") === "language")
    return <LanguageEntry><p>Language saved</p></LanguageEntry>;
  if (p.get("surface") === "auth")
    return (
      <AuthFrame title="Sign in to Mycellios" onSubmit={(e) => e.preventDefault()}>
        <Button className="w-full">Continue with Mycellios</Button>
      </AuthFrame>
    );
  if (p.get("surface") === "controls")
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect the research and development workspace</DialogTitle>
          </DialogHeader>
          <label htmlFor="long-select">Workspace</label>
          <OptionSelect
            id="long-select"
            value={value}
            onValueChange={setValue}
            options={[
              {
                value: "long",
                label:
                  "Mycellios-research-and-development-workspace-with-a-very-long-unbroken-name",
              },
              { value: "short", label: "Personal" },
            ]}
          />
        </DialogContent>
      </Dialog>
    );
  return (
    <>
      <main className="p-6">
        <h1>Mycellios</h1>
        <Button onClick={() => setOpen(true)}>Open settings</Button>
      </main>
      {open &&
        (p.get("surface") === "integrations" ? (
          <PluginsOverlay onClose={() => setOpen(false)} />
        ) : (
          <SettingsOverlay
            section={section}
            onSectionChange={setSection}
            name="Example User"
            email="example@example.com"
            timezone="Europe/Madrid"
            onTimezoneChange={async () => {}}
            onUsageOpen={() => {}}
            onClose={() => setOpen(false)}
            memoryConfig={null}
            onMemoryConfigChange={() => {}}
            space={
              {
                id: "fixture-space",
                name: p.has("long")
                  ? "A very long team space name without any convenient short label"
                  : "Personal",
                canRename: true,
                canDelete: true,
                modelOverrides: false,
                voiceOverrides: false,
                approvalOverrides: false,
              } as any
            }
            spaces={[{ id: "fixture-space", name: "Personal" }]}
            currentSpaceId="fixture-space"
            sandboxProvider="none"
          />
        ))}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <MemoryRouter>
      <QueryUserProvider value="fixture-user">
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <Fixture />
          </TooltipProvider>
        </QueryClientProvider>
      </QueryUserProvider>
    </MemoryRouter>
  </I18nProvider>,
);
