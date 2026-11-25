import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "./mycellios-cli.mjs";

const base = "https://mycellios.example/agent/api/v1/micos/mico";

async function attempt(argv, { deliveries = [], env = {}, input } = {}) {
  let time = 0;
  let stdout = "";
  let stderr = "";
  const calls = [];
  const code = await runCli(argv, {
    env: { MYCELLIOS_URL: "https://mycellios.example/agent", MYCELLIOS_TOKEN: "mycs_fixture", ...env },
    input,
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } },
    now: () => time,
    sleep: async (ms) => { time += ms; },
    fetcher: async (url, options) => {
      calls.push({ url: String(url), ...options });
      return Response.json(deliveries.shift() ?? { id: "delivery", status: "running" });
    },
  });
  return { code, stdout, stderr, calls };
}

test("sends one message, then reads the same delivery until complete", async () => {
  const result = await attempt(["run", "mico", "-", "--wait", "--id", "repeat-1", "--json"], {
    input: [Buffer.from("a\xc3", "latin1"), Buffer.from("\xb1adir", "latin1")],
    deliveries: [
      { id: "delivery", status: "queued" },
      { id: "delivery", status: "running" },
      { id: "delivery", status: "completed", answer: "done" },
    ],
  });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).answer, "done");
  assert.deepEqual(result.calls.map(({ url, method }) => [url, method]), [
    [`${base}/messages`, "POST"],
    [`${base}/deliveries/delivery`, "GET"],
    [`${base}/deliveries/delivery`, "GET"],
  ]);
  assert.deepEqual(JSON.parse(result.calls[0].body), { text: "añadir", clientMessageId: "repeat-1" });
  assert.equal(result.calls[0].redirect, "error");
});

test("timeout ends the wait without stopping or resending the work", async () => {
  const result = await attempt(["run", "mico", "hello", "--wait", "--timeout", "2s"]);
  assert.equal(result.code, 4);
  assert.match(result.stderr, /still working/);
  assert.deepEqual(result.calls.map(({ method }) => method), ["POST", "GET"]);
});

test("waiting returns control without responding to a request for human action", async () => {
  const result = await attempt(["run", "mico", "hello", "--wait"], {
    deliveries: [{ id: "delivery", status: "waiting", waitingFor: "mycellios" }],
  });
  assert.equal(result.code, 3);
  assert.equal(result.calls.length, 1);
});

test("rejects invalid Mico ids, unsafe URLs and missing text without sending a token", async () => {
  const attempts = await Promise.all([
    attempt(["run", "..", "hello"]),
    attempt(["run", "mico", "hello"], { env: { MYCELLIOS_URL: "http://mycellios.example" } }),
    attempt(["run", "mico", "--wait"]),
  ]);
  for (const result of attempts) {
    assert.equal(result.code, 2);
    assert.equal(result.calls.length, 0);
    assert.doesNotMatch(result.stderr, /mycs_fixture/);
  }
});
