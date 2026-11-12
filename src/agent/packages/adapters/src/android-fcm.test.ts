import { generateKeyPairSync, verify } from "node:crypto";
import { expect, it, vi } from "vitest";
import { androidFcmConfig, AndroidFcm } from "./android-fcm.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = androidFcmConfig({ ANDROID_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
  type: "service_account", project_id: "mycellios-test", client_email: "push@mycellios-test.iam.gserviceaccount.com",
  private_key: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
}) })!;
const message = { kind: "completion" as const, title: "Done", body: "Result", botId: "bot", threadId: "thread" };
const context = { operationId: "op", traceId: "trace", spaceId: "space", userId: "owner", signal: new AbortController().signal };

it("signs bounded FCM-only OAuth assertions and coalesces authentication", async () => {
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("oauth2")) {
      const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
      const [header, claims, signature] = assertion.split(".");
      expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
      const payload = JSON.parse(Buffer.from(claims!, "base64url").toString());
      expect(payload).toMatchObject({ iss: config.clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token" });
      expect(payload.exp - payload.iat).toBe(3600);
      expect(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), keys.publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
      return Response.json({ access_token: "secret-token", expires_in: 3600 });
    }
    expect(String(url)).toBe("https://fcm.googleapis.com/v1/projects/mycellios-test/messages:send");
    const payload = JSON.parse(String(init?.body)).message;
    expect(payload.notification).toBeUndefined();
    expect(payload.data).toMatchObject({ accountId: "owner", spaceId: "space", version: "1", groupId: "group" });
    expect(payload.data.taskThreadId).toBeUndefined();
    expect(payload.data.deliveryId).toMatch(/^[a-f0-9]{64}$/);
    expect(init?.redirect).toBe("error");
    return Response.json({ name: "projects/mycellios-test/messages/1" });
  });
  const sender = new AndroidFcm(config, request as typeof fetch);
  await Promise.all([sender.send("device", { ...message, groupId: "group", taskThreadId: "task" }, context), sender.send("device2", { ...message, groupId: "group" }, context)]);
  expect(request.mock.calls.filter(([url]) => String(url).includes("oauth2"))).toHaveLength(1);
});

it("marks only an explicitly unregistered device as expired", async () => {
  const request = vi.fn(async (url: string | URL | Request) => String(url).includes("oauth2")
    ? Response.json({ access_token: "secret", expires_in: 3600 })
    : Response.json({ error: { details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 }));
  await expect(new AndroidFcm(config, request as typeof fetch).send("device", message, context)).resolves.toBe("unregistered");
});

it("renews authorization after a rejected token without unbounded retries", async () => {
  let auth = 0, sends = 0;
  const request = vi.fn(async (url: string | URL | Request) => String(url).includes("oauth2")
    ? Response.json({ access_token: `secret-${++auth}`, expires_in: 3600 })
    : ++sends === 1 ? new Response("", { status: 401 }) : Response.json({ name: "ok" }));
  await expect(new AndroidFcm(config, request as typeof fetch).send("device", message, context)).resolves.toBe("delivered");
  expect(auth).toBe(2); expect(sends).toBe(2);
});

it("does not expose malformed vendor responses or credentials in errors", async () => {
  const request = vi.fn(async () => new Response('private-vendor-fragment'));
  await expect(new AndroidFcm(config, request as typeof fetch).send("device", message, context)).rejects.toThrow(/^Android push returned an invalid response$/);
  expect(() => androidFcmConfig({ ANDROID_FCM_SERVICE_ACCOUNT_JSON: "private-credential-fragment" })).toThrow(/^Invalid Android FCM service-account configuration$/);
  expect(androidFcmConfig({})).toBeUndefined();
});

it("bounds vendor response size", async () => {
  const request = vi.fn(async () => new Response("x".repeat(65537)));
  await expect(new AndroidFcm(config, request as typeof fetch).send("device", message, context)).rejects.toThrow("response exceeded its limit");
});

it("retries non-JSON temporary gateway failures without treating them as expired tokens", async () => {
  let sends = 0;
  const ids: string[] = [];
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { if (!String(url).includes("oauth2")) ids.push(JSON.parse(String(init?.body)).message.data.deliveryId); return String(url).includes("oauth2")
    ? Response.json({ access_token: "secret", expires_in: 3600 })
    : ++sends === 1 ? new Response("temporary gateway failure", { status: 503 }) : Response.json({ name: "ok" }); });
  const sender = new AndroidFcm(config, request as typeof fetch);
  await expect(sender.send("device", message, context)).resolves.toBe("delivered");
  expect(sends).toBe(2);
  expect(ids[0]).toBe(ids[1]);
  await sender.send("device", message, context);
  expect(ids[2]).not.toBe(ids[0]);
});
