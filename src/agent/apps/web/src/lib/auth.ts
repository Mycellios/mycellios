import { passkeyClient } from "@better-auth/passkey/client";
import type { OrganizationClientOptions } from "better-auth/client/plugins";
import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient, type ReactAuthClient } from "better-auth/react";
import { appPath } from "./app-path";

export const authClient: ReactAuthClient<{
  // An uninstantiated generic resolves to `any`, which would erase every plugin's actions.
  plugins: [
    ReturnType<typeof organizationClient<OrganizationClientOptions>>,
    ReturnType<typeof emailOTPClient>,
    ReturnType<typeof passkeyClient>,
  ];
}> = createAuthClient({
  basePath: appPath("/api/auth"),
  sessionOptions: {
    refetchInterval: 30 * 60,
    refetchOnWindowFocus: true,
    refetchWhenOffline: false,
  },
  plugins: [organizationClient(), emailOTPClient(), passkeyClient()],
});
