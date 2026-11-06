import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computerConsentScope, prepareHostComputer } from "./host-computer.js";

describe("desktop local computer consent", () => {
  let root: string;
  let computer: Awaited<ReturnType<typeof prepareHostComputer>>;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "rakazo-native-consent-"));
    computer = await prepareHostComputer(root);
  });
  afterEach(async () => {
    await computer.close();
    await rm(root, { recursive: true, force: true });
  });

  it("exposes the persistent agent workspace to the runner without requiring a folder selection", async () => {
    const botId = "runner-agent";
    const key = createHash("sha256").update(botId).digest("hex");
    const expected = path.join(root, "computers", "desktop-computers", key);
    expect(computer.workspace(botId)).toBe(expected);
    expect(computer.project(botId)).toBeNull();
    expect(computer.isEnabled()).toBe(false);
    await computer.close();
    computer = await prepareHostComputer(root);
    expect(computer.workspace(botId)).toBe(expected);
    expect(computer.workspace("another-agent")).not.toBe(expected);
  });

  it("restores the account grant after a real host restart without enabling another account or server", async () => {
    const scope = computerConsentScope("https://example.test/agent", { userId: "owner" });
    await computer.grant(scope);
    await computer.close();
    computer = await prepareHostComputer(root);
    expect(computer.hasRememberedAccess(scope)).toBe(true);
    expect(computer.hasRememberedAccess(computerConsentScope("https://example.test/agent", {userId:"other"}))).toBe(false);
    expect(computer.hasRememberedAccess(computerConsentScope("https://other.test/agent", {userId:"owner"}))).toBe(false);
    expect(computer.isEnabled()).toBe(false);
    await computer.grant(scope);
    computer.activate(true);
    expect(computer.isEnabled()).toBe(true);
    expect(computer.executionScope()).toBe(scope);
    await computer.revoke();expect(computer.executionScope()).toBeUndefined();
  });

  it("does not forget account consent when transport credentials must rotate", async () => {
    const scope = computerConsentScope("https://example.test", {userId:"owner"});
    await computer.grant(scope);
    const port = Number(new URL(computer.connection.url).port);
    const previousToken = computer.connection.token;
    await computer.close();
    const occupied = createServer();
    await new Promise<void>(resolve=>occupied.listen(port,"0.0.0.0",resolve));
    try {
      computer = await prepareHostComputer(root);
      expect(computer.connection.token).not.toBe(previousToken);
      expect(computer.hasRememberedAccess(scope)).toBe(true);
      expect(computer.isEnabled()).toBe(false);
      await computer.grant(scope);
      computer.activate(true);
      expect(computer.isEnabled()).toBe(true);
    } finally { await new Promise<void>(resolve=>occupied.close(()=>resolve())); }
  });

  it("persists revocation of both the local and account grants during concurrent writes", async () => {
    const scope=computerConsentScope("https://example.test",{userId:"owner"});
    await Promise.all([computer.grant(scope),computer.revoke()]);
    expect(computer.isEnabled()).toBe(false);
    expect(computer.hasRememberedAccess(scope)).toBe(false);
    await computer.close();
    computer=await prepareHostComputer(root);
    expect(computer.hasRememberedAccess(scope)).toBe(false);
  });

  it("does not revive a stale account record after local permission was revoked", async () => {
    const scope=computerConsentScope("https://example.test",{userId:"owner"});
    await computer.grant(scope);
    await computer.revoke();
    await computer.close();
    await writeFile(path.join(root,"host-computer-account-consent"),scope);
    computer=await prepareHostComputer(root);
    expect(computer.hasRememberedAccess(scope)).toBe(false);
  });

  it("rotates the credential and requires consent again if another listener claims the saved port", async () => {
    await computer.grant();
    const previous = computer.connection;
    const port = Number(new URL(previous.url).port);
    await computer.close();
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(port, "0.0.0.0", resolve));
    try {
      computer = await prepareHostComputer(root);
      expect(computer.connection.token).not.toBe(previous.token);
      computer.activate(true);
      expect(computer.isEnabled()).toBe(false);
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it("keeps a later revocation when an earlier grant is still being persisted", async () => {
    computer.activate(true);
    await Promise.all([computer.grant(), computer.revoke()]);
    expect(computer.isEnabled()).toBe(false);
    await computer.close();
    computer = await prepareHostComputer(root);
    computer.activate(true);
    expect(computer.isEnabled()).toBe(false);
  });

  it("forgets the selected folder on revocation before allowing a new grant", async () => {
    computer.activate(true);
    await computer.grant();
    await computer.selectProject("project-agent", root);
    expect(computer.project("project-agent")?.path).toBe(root);
    await computer.revoke();
    await computer.grant();
    expect(computer.project("project-agent")).toBeNull();
  });

  it("remembers consent but only activates for the app-managed instance", async () => {
    computer.activate(true);
    expect(computer.isEnabled()).toBe(false);
    await computer.grant();
    expect(computer.isEnabled()).toBe(true);
    computer.activate(false);
    expect(computer.isEnabled()).toBe(false);
    const connection = computer.connection;
    await computer.close();
    computer = await prepareHostComputer(root);
    expect(computer.connection).toEqual(connection);
    expect(computer.isEnabled()).toBe(false);
    computer.activate(true);
    expect(computer.isEnabled()).toBe(true);
    await computer.revoke();
    expect(computer.isEnabled()).toBe(false);
    expect(await readFile(path.join(root, "host-computer-consent"), "utf8")).toBe("");
    computer.activate(true);
    expect(computer.isEnabled()).toBe(false);
    await computer.close();
    computer = await prepareHostComputer(root);
    computer.activate(true);
    expect(computer.isEnabled()).toBe(false);
  });
});

it("normalizes the server path and does not bind permission to a transient session or Space", () => {
  const scope=computerConsentScope("https://example.test/agent/",{userId:"owner"});
  const nextSession={userId:"owner",spaceId:"another-space",connectionId:"another-session"};
  expect(computerConsentScope("https://example.test/agent",nextSession)).toBe(scope);
  expect(computerConsentScope("https://example.test/other",nextSession)).not.toBe(scope);
});
