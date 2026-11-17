import { expect, it } from "vitest";
import { developerContextLink } from "./developer-context-link";

it("opens the current Mico and nested conversation in its owned Space", () => {
  const url = new URL(developerContextLink({ botId: "mico-1", spaceId: "space-1", threadId: "thread-2", taskThreadId: "thread-2", runId: "run-3" }, "https://mycellios.example", "/agent/"));
  expect(url.pathname).toBe("/agent/app/mico-1");
  expect(Object.fromEntries(url.searchParams)).toEqual({ noticeSpace: "space-1", task: "thread-2", threadId: "thread-2", runId: "run-3" });
});

it("keeps the main conversation route and the local environment", () => {
  const url = new URL(developerContextLink({ botId: "mico-1", threadId: "main-thread" }, "http://127.0.0.1:5192", "/"));
  expect(url.origin).toBe("http://127.0.0.1:5192");
  expect(url.pathname).toBe("/app/mico-1");
  expect(Object.fromEntries(url.searchParams)).toEqual({ threadId: "main-thread" });
});

it("copies lookup IDs only, excluding transient credentials, hash and unrelated views", () => {
  const url = new URL(developerContextLink({ botId: "mico-1" }, "https://user:password@mycellios.example/agent/app/old?token=secret&code=oauth&view=settings#private", "/agent/"));
  expect(url.href).toBe("https://mycellios.example/agent/app/mico-1");
});
