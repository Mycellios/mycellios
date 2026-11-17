import { EventEmitter } from "node:events";
import type { ClientRequest, Session } from "electron";
import { describe, expect, it, vi } from "vitest";
import { forwardDocument, isDocumentRequest } from "./renderer-navigation.js";

const authorize = "https://www.mycellios.com/agent/auth/v1/oauth/authorize?client_id=fixture";

function fakeNet() {
  const client = Object.assign(new EventEmitter(), {
    setHeader: vi.fn((key: string) => { if (key === "host") throw new Error("forbidden"); }),
    abort: vi.fn(),
    end: vi.fn(),
  });
  const netRequest = vi.fn(() => client as unknown as ClientRequest);
  return { client, netRequest };
}

describe("renderer navigation", () => {
  it("treats only page loads as documents", () => {
    expect(isDocumentRequest(new Request(authorize, { headers: { "sec-fetch-dest": "document" } }))).toBe(true);
    expect(isDocumentRequest(new Request(authorize, { headers: { "sec-fetch-dest": "iframe" } }))).toBe(true);
    expect(isDocumentRequest(new Request(authorize, { headers: { "sec-fetch-dest": "empty", accept: "text/html" } }))).toBe(false);
    expect(isDocumentRequest(new Request(authorize, { headers: { accept: "text/html,application/xhtml+xml" } }))).toBe(true);
    expect(isDocumentRequest(new Request(authorize, { headers: { accept: "application/json" } }))).toBe(false);
    expect(isDocumentRequest(new Request(authorize, { method: "POST", headers: { "sec-fetch-dest": "document" } }))).toBe(false);
  });

  it("hands the window the real redirect so OAuth keeps its authorization_id", async () => {
    const { client, netRequest } = fakeNet();
    const pending = forwardDocument(new Request(authorize), {} as Session, new Headers({ origin: "https://www.mycellios.com", host: "x" }), netRequest);
    expect(netRequest).toHaveBeenCalledWith(expect.objectContaining({ url: authorize, redirect: "manual", useSessionCookies: true, bypassCustomProtocolHandlers: true }));
    expect(client.setHeader).toHaveBeenCalledWith("origin", "https://www.mycellios.com");
    client.emit("redirect", 302, "GET", "https://www.mycellios.com/oauth/consent?authorization_id=abc", {});
    const response = await pending;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://www.mycellios.com/oauth/consent?authorization_id=abc");
    expect(client.abort).toHaveBeenCalled();
  });

  it("streams an ordinary page with its status and headers", async () => {
    const { client, netRequest } = fakeNet();
    const pending = forwardDocument(new Request("https://www.mycellios.com/agent/app"), {} as Session, new Headers(), netRequest);
    const response = Object.assign(new EventEmitter(), { statusCode: 200, statusMessage: "OK", headers: { "content-type": "text/html", "set-cookie": ["a=1", "b=2"] } });
    client.emit("response", response);
    const result = await pending;
    response.emit("data", Buffer.from("<html>ok</html>"));
    response.emit("end");
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("text/html");
    expect(await result.text()).toBe("<html>ok</html>");
  });

  it("rejects when the network request fails", async () => {
    const { client, netRequest } = fakeNet();
    const pending = forwardDocument(new Request(authorize), {} as Session, new Headers(), netRequest);
    client.emit("error", new Error("offline"));
    await expect(pending).rejects.toThrow("offline");
  });
});
