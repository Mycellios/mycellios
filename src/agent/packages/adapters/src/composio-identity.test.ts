import type { AdapterContext } from "@rakazo/adapter-kit";
import { expect, it, vi } from "vitest";
import type { ComposioClient } from "./composio-connector.js";
import { FakeComposioClient } from "./composio-fake.js";
import { createComposioIdentityReader } from "./composio-identity.js";

const owner = { userId: "owner", spaceId: "forest-space" } as AdapterContext;

function fixture() {
  const fake = new FakeComposioClient();
  const id = fake.connect(owner.userId, "twitter");
  const sdk: ComposioClient = fake;
  const get = vi.fn().mockResolvedValue({
    getCurrentUserEndpoint: "https://api.example.test/2/users/me",
    getCurrentUserEndpointMethod: "GET",
  });
  const proxy = vi.fn().mockResolvedValue({
    status: 200,
    data: {
      data: { username: "forest_fixture", name: "Forest Lab", access_token: "fixture-secret" },
    },
  });
  sdk.toolkits = { get };
  sdk.tools = { proxyExecute: proxy };
  return { fake, id, sdk, get, proxy, read: createComposioIdentityReader(() => sdk) };
}

it("reads the exact owned authorization through the read-only profile endpoint", async () => {
  const { fake, id, read, proxy } = fixture();
  fake.connect(owner.userId, "twitter");
  const result = await read({ provider: "twitter", connectionRef: id }, owner);
  expect(result).toEqual({ label: "@forest_fixture" });
  expect(proxy).toHaveBeenCalledWith(
    { endpoint: "https://api.example.test/2/users/me", method: "GET", connectedAccountId: id },
    { signal: expect.any(AbortSignal) },
  );
  expect(fake.accountListCalls[0]).toMatchObject({
    userIds: [owner.userId],
    toolkitSlugs: ["twitter"],
    statuses: ["ACTIVE"],
  });
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
});

it("never substitutes another owner's, pending or wrong-provider account", async () => {
  const { fake, read, proxy } = fixture();
  const foreign = fake.connect("other-owner", "twitter");
  const pending = fake.connect(owner.userId, "twitter", "INITIATED");
  const github = fake.connect(owner.userId, "github");
  for (const ref of [foreign, pending, github, "twitter", "missing"]) {
    expect(await read({ provider: "twitter", connectionRef: ref }, owner)).toBeNull();
  }
  expect(proxy).not.toHaveBeenCalled();
});

it("resolves separate profiles for two authorizations of the same provider", async () => {
  const { fake, id, read, proxy } = fixture();
  const second = fake.connect(owner.userId, "twitter");
  proxy.mockImplementation(async ({ connectedAccountId }) => ({
    status: 200,
    data: { data: { username: connectedAccountId === id ? "forest_fixture" : "mycelium_team" } },
  }));
  expect(await read({ provider: "twitter", connectionRef: id }, owner)).toEqual({
    label: "@forest_fixture",
  });
  expect(await read({ provider: "twitter", connectionRef: second }, owner)).toEqual({
    label: "@mycelium_team",
  });
});

it("returns unavailable when the optional provider is not configured", async () => {
  const read = createComposioIdentityReader(() => {
    throw new Error("fixture-provider-not-configured");
  });
  expect(await read({ provider: "twitter", connectionRef: "fixture-id" }, owner)).toBeNull();
});

it("follows pagination and keeps caches separate for each owner, Space and authorization", async () => {
  const { fake, read, proxy } = fixture();
  const original = fake.connectedAccounts.list.bind(fake.connectedAccounts);
  vi.spyOn(fake.connectedAccounts, "list").mockImplementation((query, options) =>
    original({ ...query, limit: 1 }, options),
  );
  const second = fake.connect(owner.userId, "twitter");
  expect(await read({ provider: "twitter", connectionRef: second }, owner)).toEqual({
    label: "@forest_fixture",
  });
  await read({ provider: "twitter", connectionRef: second }, owner);
  expect(proxy).toHaveBeenCalledTimes(1);
  expect(fake.accountListCalls.length).toBeGreaterThan(1);
  await read({ provider: "twitter", connectionRef: second }, { ...owner, spaceId: "other-space" });
  expect(proxy).toHaveBeenCalledTimes(2);
  expect(
    await read({ provider: "twitter", connectionRef: second }, { ...owner, userId: "other-owner" }),
  ).toBeNull();
});

it("uses only provider displayName as fallback, never aliases or credential fields", async () => {
  const { sdk, id, read, get, proxy } = fixture();
  const original = sdk.connectedAccounts.list.bind(sdk.connectedAccounts);
  vi.spyOn(sdk.connectedAccounts, "list").mockImplementation(async (...args) => {
    const page = await original(...args);
    return {
      ...page,
      items: page.items.map((row) => ({
        ...row,
        alias: "not-a-provider-identity",
        state: {
          authScheme: "OAUTH2" as const,
          val: {
            status: "ACTIVE" as const,
            displayName: "Forest Lab",
            access_token: "fixture-secret",
          },
        },
      })),
    };
  });
  get.mockResolvedValue({
    getCurrentUserEndpoint: "https://api.example.test/profile",
    getCurrentUserEndpointMethod: "POST",
  });
  expect(await read({ provider: "twitter", connectionRef: id }, owner)).toEqual({
    label: "Forest Lab",
  });
  expect(proxy).not.toHaveBeenCalled();
});

it("does not expose raw provider failures or make unsafe profile requests", async () => {
  const { id, read, get, proxy } = fixture();
  get.mockResolvedValue({
    getCurrentUserEndpoint: "http://unsafe.example.test/profile",
    getCurrentUserEndpointMethod: "GET",
  });
  expect(await read({ provider: "twitter", connectionRef: id }, owner)).toBeNull();
  expect(proxy).not.toHaveBeenCalled();
  const next = fixture();
  next.proxy.mockRejectedValue(new Error("raw-provider-payload fixture-secret"));
  expect(await next.read({ provider: "twitter", connectionRef: next.id }, owner)).toBeNull();
});
