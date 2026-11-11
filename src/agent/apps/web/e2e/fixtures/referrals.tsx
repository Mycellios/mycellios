import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { InviteFriends } from "../../src/components/InviteFriends";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import type { RpcClient } from "../../src/lib/rpc";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import "../../src/styles.css";

// Browser qualification only: no accounts, reward writes or external providers.
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.has("dark"));
const client = { referrals: { invite: async () => {
  if (params.has("unavailable")) throw new Error("Fixture unavailable");
  return { code: "f".repeat(43), link: `https://www.mycellios.com/v1/referrals/visit/${"f".repeat(43)}`,
    rewardMicrounits: 1000000, rewardDays: 14, rewardedInvites: 2 };
} } } as unknown as RpcClient;
void bootstrapI18n("es").then(() => createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}><SpaceRpcProvider spaceId="fixture" client={client}>
    <main className="min-h-dvh bg-background p-8 text-foreground"><InviteFriends userId="fixture-user" /></main>
  </SpaceRpcProvider></I18nProvider>,
));
