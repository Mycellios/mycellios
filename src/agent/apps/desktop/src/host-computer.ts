import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { startHostComputerServer } from "@rakazo/adapters/host-computer-server";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

/** Remember the account and server, independently of sessions, Spaces and host credentials. */
export function computerConsentScope(serverUrl: string, identity: { userId: string }) {
  const server = new URL(serverUrl);
  if (!["https:", "http:"].includes(server.protocol) || !identity.userId || identity.userId.length > 256)
    throw new Error("Invalid computer consent account");
  return createHash("sha256")
    .update(JSON.stringify([server.origin, server.pathname.replace(/\/+$/, ""), identity.userId]))
    .digest("hex");
}

/** App-private credentials and consent, never sent to a renderer or a connected remote server. */
export async function prepareHostComputer(userDataDir: string) {
  const configFile = path.join(userDataDir, "host-computer.json");
  const consentFile = path.join(userDataDir, "host-computer-consent");
  const accountConsentFile = path.join(userDataDir, "host-computer-account-consent");
  let rememberedAccount = await readPrivateFile(accountConsentFile, 128);
  const raw = await readPrivateFile(configFile, 1024);
  let token = randomBytes(32).toString("hex");
  let port = 0;
  try {
    const saved = JSON.parse(raw ?? "null");
    if (/^[a-f0-9]{64}$/.test(saved?.token)) token = saved.token;
    if (Number.isInteger(saved?.port) && saved.port >= 1024 && saved.port <= 65535)
      port = saved.port;
  } catch {
    /* Invalid local configuration is replaced. */
  }
  let server: Awaited<ReturnType<typeof startHostComputerServer>>;
  const options = { root: path.join(userDataDir, "computers"), token };
  try {
    server = await startHostComputerServer({ ...options, port });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EADDRINUSE")
      throw error;
    // A listener on the old port may have received the old credential from a still-running backend.
    token = randomBytes(32).toString("hex");
    server = await startHostComputerServer({ ...options, token });
  }
  try {
    await writePrivateFile(configFile, JSON.stringify({ token, port: server.port }));
  } catch (error) {
    await server.close();
    throw error;
  }
  const storedConsent = await readPrivateFile(consentFile, 128);
  let allowed = storedConsent === token;
  let accountGrantAllowed = /^[a-f0-9]{64}$/.test(storedConsent ?? "");
  let active = false;
  let consentIntent = 0;
  let consentWrites: Promise<void> = Promise.resolve();
  function persistConsent(value: string, account?: string) {
    const write = consentWrites.then(async () => {
      await writePrivateFile(consentFile, value);
      if (account !== undefined) {
        await writePrivateFile(accountConsentFile, account);
      }
    });
    consentWrites = write.catch(() => undefined);
    return write;
  }
  return {
    connection: { url: `http://host.docker.internal:${server.port}`, token },
    selectProject: server.selectProject,
    bindTaskProject: server.bindTaskProject,
    taskProject: server.taskProject,
    lockProject: server.lockProject,
    project: server.project,
    workspace: server.workspace,
    isEnabled: server.isEnabled,
    hasActiveWork: server.hasActiveWork,
    prepareUpdate: server.prepareUpdate,
    cancelUpdate: server.cancelUpdate,
    hasRememberedAccess(scope: string) {
      return accountGrantAllowed && /^[a-f0-9]{64}$/.test(scope) && rememberedAccount === scope;
    },
    activate(value: boolean) {
      active = value;
      server.setEnabled(active && allowed);
    },
    async grant(scope?: string) {
      if (scope !== undefined && !/^[a-f0-9]{64}$/.test(scope)) throw new Error("Invalid computer consent scope");
      const intent = ++consentIntent;
      await persistConsent(token, scope);
      if (intent === consentIntent) {
        if (scope !== undefined) rememberedAccount = scope;
        accountGrantAllowed = true;
        allowed = true;
        server.setEnabled(active);
      }
    },
    async revoke() {
      // Revoke first, even if persisting the choice fails.
      ++consentIntent;
      allowed = false;
      accountGrantAllowed = false;
      rememberedAccount = null;
      server.setEnabled(false);
      server.clearProjects();
      await persistConsent("", "");
    },
    close: server.close,
  };
}
