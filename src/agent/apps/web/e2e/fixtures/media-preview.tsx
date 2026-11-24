import { I18nProvider } from "@lingui/react";
import { ATTACHMENT_DOCX_MIME_TYPE } from "@mycellios/contracts";
import { createRoot } from "react-dom/client";
import { ArtifactFileCard } from "../../src/components/ArtifactFileCard";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const card = params.has("audio")
  ? { artifactId: "demo-audio", name: "audio.wav", mimeType: "audio/wav", size: 16044 }
  : params.has("docx")
    ? {
        artifactId: "demo-docx",
        name: "report.docx",
        mimeType: ATTACHMENT_DOCX_MIME_TYPE,
        size: 2048,
      }
    : { artifactId: "demo-video", name: "generated-video.mp4", mimeType: "video/mp4", size: 902 };
await bootstrapI18n();
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="max-w-md">
        <ArtifactFileCard target={{ botId: "demo-bot" }} {...card} />
      </div>
    </main>
  </I18nProvider>,
);
