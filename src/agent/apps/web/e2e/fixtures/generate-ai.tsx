import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { MycelliosCredits } from "../../src/components/MycelliosCredits";
import { authClient } from "../../src/lib/auth";
import { BrowserContributionControl } from "../../src/components/BrowserContributionControl";
import { messages } from "../../src/locales/es/messages.po";
import "../../src/styles.css";
import "../../src/components/contribution.css";
const i18n=setupI18n({locale:"es",messages:{es:messages}});
function Footer(){ const session=authClient.useSession();return <div className="mx-3 mt-1 flex shrink-0 flex-col gap-1 border-t border-border py-2"><div className="w-full px-2"><MycelliosCredits ownerId={session.data?.user.id ?? ""}/></div><BrowserContributionControl/></div>;}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><main className="grid min-h-dvh place-items-center bg-background"><aside className="w-80 bg-sidebar p-4"><Footer/></aside></main></I18nProvider>);
