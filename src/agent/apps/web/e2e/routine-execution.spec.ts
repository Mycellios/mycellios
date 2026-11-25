import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Routine } from "@mycellios/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("Slack message and GitHub event triggers persist their settings", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/messaging/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: { enabled: true, providers: ["slack"], openSignup: false, identities: [] },
      }),
    }),
  );
  const stamp = Date.now();
  await signup(page, `routine-triggers-${stamp}@mycellios.test`, "password12", "Trigger Routine");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const savedRoutine = async (name: string) => {
    const saved = page.waitForResponse(
      (response) => response.url().includes("/rpc/routines/create") && response.ok(),
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await saved;
    const routines = await rpc<Routine[]>(page, "routines/list", { botId });
    return routines.find((routine) => routine.name === name);
  };

  await page.getByRole("button", { name: "Agent computer", exact: true }).click();
  await page.getByRole("button", { name: "Create Routine" }).click();
  await page.getByPlaceholder("Name this routine").fill("Triage Slack updates");
  await page
    .getByPlaceholder("What should this routine do each time it runs?")
    .fill("Review the verified message event");
  await page.getByRole("button", { name: "Add trigger" }).click();
  await page.getByRole("menuitem", { name: "Slack message", exact: true }).click();

  const panel = page.getByTestId("side-panel");
  await expect(panel.getByText("Slack message", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("Runs when this bot receives a verified message from this provider."),
  ).toBeVisible();

  expect(await savedRoutine("Triage Slack updates")).toMatchObject({
    crons: [],
    webhookEnabled: false,
    githubEnabled: false,
    messageProvider: "slack",
  });
  await captureScreenshot(page, testInfo, "routine-slack-message");

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Create Routine" }).click();
  await page.getByPlaceholder("Name this routine").fill("Review repository events");
  await page
    .getByPlaceholder("What should this routine do each time it runs?")
    .fill("Inspect the signed GitHub event");
  await page.getByRole("button", { name: "Add trigger" }).click();
  await page.getByRole("menuitem", { name: "Git event", exact: true }).click();

  await expect(panel.getByText("Git event", { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`/api/v1/bots/${botId}/github$`))).toBeVisible();
  await expect(page.getByText("X-Hub-Signature-256: sha256=…", { exact: true })).toBeVisible();

  expect(await savedRoutine("Review repository events")).toMatchObject({
    crons: [],
    webhookEnabled: false,
    githubEnabled: true,
  });
  await captureScreenshot(page, testInfo, "routine-github-event");
});

test("Korean webhook routine keeps technical field labels in English", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const userName = `Korean Routine ${stamp}`;
  await signup(page, `routine-ko-${stamp}@mycellios.test`, "password12", userName);
  await completeOnboarding(page);

  await page.getByRole("button", { name: new RegExp(userName) }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByTestId("user-settings");
  await settings.getByTestId("ui-locale-select").click();
  await page.getByRole("option", { name: "한국어", exact: true }).click();
  await page.getByRole("button", { name: "계정 설정 닫기" }).click();

  await page.getByRole("button", { name: "Agent 컴퓨터", exact: true }).click();
  await page.getByRole("button", { name: "자동 실행 만들기" }).click();
  await page.getByPlaceholder("이 루틴의 이름을 정하세요").fill("한국어 웹훅 확인");
  await page
    .getByPlaceholder("이 루틴이 실행될 때마다 무엇을 해야 하나요?")
    .fill("웹훅을 확인합니다.");
  await page.getByRole("button", { name: "트리거 추가" }).click();
  await page.getByRole("menuitem", { name: "웹훅", exact: true }).click();

  await expect(page.getByText("웹훅이 실행될 때", { exact: true })).toBeVisible();
  await expect(page.getByText("POST 대상")).toBeVisible();
  // The signing scheme is a proper name and stays as it is in every language.
  await expect(page.getByText(/Standard Webhooks/)).toBeVisible();
  await captureScreenshot(page, testInfo, "routine-webhook-ko");
});

test("a webhook routine gets its own signed URL, a secret shown once and event filters", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  const stamp = Date.now();
  await signup(page, `routine-signed-${stamp}@mycellios.test`, "password12", "Signed Routine");
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Agent computer", exact: true }).click();
  await page.getByRole("button", { name: "Create Routine" }).click();
  await page.getByPlaceholder("Name this routine").fill("Paid invoices");
  await page
    .getByPlaceholder("What should this routine do each time it runs?")
    .fill("Summarize the paid invoice");
  await page.getByRole("button", { name: "Add trigger" }).click();
  await page.getByRole("menuitem", { name: "Webhook", exact: true }).click();

  const card = page.getByTestId("routine-webhook-card");
  await expect(card.getByText("Available after the routine is saved")).toBeVisible();
  await card.getByText("Only some events").click();
  await card.getByLabel("Event type").fill("invoice.paid");
  await card.getByRole("button", { name: "Add filter" }).click();
  await card.getByLabel("Data field").fill("/status");
  await card.getByLabel("Value", { exact: true }).fill("paid");
  await captureScreenshot(page, testInfo, "routine-signed-webhook-01-filters");

  const created = page.waitForResponse(
    (response) => response.url().includes("/rpc/routines/create") && response.ok(),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const routine = ((await (await created).json()) as { json: Routine }).json;
  expect(routine.webhook).toMatchObject({
    secretCreatedAt: null,
    eventType: "invoice.paid",
    filters: [{ pointer: "/status", value: "paid" }],
  });
  const path = `/api/v1/routines/${routine.id}/events`;
  await expect(card.getByText(path)).toBeVisible();
  await card.getByRole("button", { name: "Create secret" }).click();
  const secretCell = card.getByTestId("routine-webhook-secret");
  await expect(secretCell).toHaveText(/^whsec_/);
  const secret = (await secretCell.textContent())?.trim() ?? "";
  await captureScreenshot(page, testInfo, "routine-signed-webhook-02-secret-once");

  // A Standard Webhooks sender: HMAC-SHA256 of id.timestamp.body with the secret's key bytes.
  const post = (body: string, id: string, key = secret) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", Buffer.from(key.slice("whsec_".length), "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    return page.request.post(path, {
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      },
      data: body,
    });
  };
  const paid = JSON.stringify({ type: "invoice.paid", data: { status: "paid" } });
  const failed = JSON.stringify({ type: "invoice.failed", data: { status: "failed" } });
  const ignored = await post(failed, `msg_failed_${stamp}`);
  expect([ignored.status(), await ignored.json()]).toEqual([
    202,
    { ok: true, status: "ignored", reason: "event_type" },
  ]);
  const accepted = await post(paid, `msg_paid_${stamp}`);
  expect(accepted.status()).toBe(202);
  const { runId } = (await accepted.json()) as { runId: string };
  expect(runId).toBeTruthy();
  const repeat = await post(paid, `msg_paid_${stamp}`);
  expect([repeat.status(), (await repeat.json()).runId]).toEqual([200, runId]);
  const forged = await post(paid, `msg_forged_${stamp}`, `whsec_${Buffer.alloc(32, 7).toString("base64")}`);
  expect(forged.status()).toBe(401);

  await card.getByRole("button", { name: "Rotate secret" }).click();
  await expect(card.getByTestId("routine-webhook-previous")).toBeVisible();
  await expect(secretCell).not.toHaveText(secret);
  // The replaced secret keeps working for 24 hours.
  expect((await post(paid, `msg_previous_${stamp}`)).status()).toBe(202);

  const history = page.getByTestId("routine-run-history");
  await history.getByRole("button", { name: "Run history" }).click();
  await history.getByRole("button", { name: "Refresh" }).click();
  await expect(history.getByText("Ignored: other event type")).toBeVisible();
  await captureScreenshot(page, testInfo, "routine-signed-webhook-03-rotated-history");
});

test("routine test-run completes and survives reload", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `routine-${stamp}@mycellios.test`, "password12", "Routine");
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Agent computer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Test run" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create Routine" }).click();
  await page.locator("label:has-text('Name') input").fill("Daily verification");
  await page
    .locator("label:has-text('Instruction') textarea")
    .fill("write routine-run-now-ok into the durable task result");
  await page.getByRole("button", { name: "Add trigger" }).click();
  await page.getByRole("menuitem", { name: "On a schedule" }).hover();
  await page.getByRole("menuitem", { name: "Weekdays", exact: true }).click();
  await expect(page.getByLabel("How often")).toHaveValue("Weekdays");
  await captureScreenshot(page, testInfo, "32-routine-configured");

  const saved = page.waitForResponse(
    (response) => response.url().includes("/rpc/routines/create") && response.ok(),
  );
  await page.getByRole("button", { name: "Save" }).click();
  await saved;
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await page.getByRole("button", { name: "Back" }).click();
  const routine = page.getByRole("button", { name: /Daily verification/ });
  await expect(routine).toContainText("Weekdays at 9:00 AM");
  await captureScreenshot(page, testInfo, "33-routine-scheduled");

  await routine.click();
  await page.getByRole("button", { name: "Test run" }).click();
  await expect(page.getByText(/routine-run-now-ok/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "34-routine-run-completed");

  await page.reload();
  await expect(page.getByText(/routine-run-now-ok/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Agent computer", exact: true }).click();
  await expect(page.getByRole("button", { name: /Daily verification/ })).toContainText(
    "Weekdays at 9:00 AM",
  );
  await page.getByRole("button", { name: /Daily verification/ }).click();
  const history = page.getByTestId("routine-run-history");
  await expect(history.getByTestId("routine-run-row")).toHaveCount(1);
  await expect(history.getByText("Done", { exact: true })).toBeVisible();
  await expect(history.getByText("No runs yet")).toHaveCount(0);
  await expect(history.getByRole("link", { name: "View chat" })).toBeVisible();
  await expect(history.getByRole("button", { name: "Run history" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await history.getByRole("button", { name: "Run history" }).click();
  await expect(history.getByRole("button", { name: "Run history" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(history.getByTestId("routine-run-row")).toHaveCount(1);
  await captureScreenshot(page, testInfo, "36-routine-run-history");
  await history.getByRole("link", { name: "View chat" }).click();
  await expect(page.getByText(/routine-run-now-ok/i).first()).toBeVisible();
  await captureScreenshot(page, testInfo, "35-routine-run-persisted");
});

test("an unchanged routine completes without adding a chat reply", async ({ page }, testInfo) => {
  await signup(page, `routine-silent-${Date.now()}@mycellios.test`, "password12", "Quiet Routine");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const routine = await rpc<Routine>(page, "routines/create", {
    botId,
    name: "Quiet release check",
    prompt: "silent routine fixture",
    crons: ["0 9 * * *"],
    timezone: "UTC",
    active: false,
    notify: true,
  });
  const { runId } = await rpc<{ runId: string }>(page, "routines/testRun", {
    routineId: routine.id,
  });
  await expect
    .poll(async () => {
      const history = await rpc<{ runs: Array<{ id: string; status: string }> }>(
        page,
        "routines/history",
        { routineId: routine.id },
      );
      return history.runs.find((run) => run.id === runId)?.status;
    })
    .toBe("completed");
  const snapshot = await rpc<{
    messages: Array<{ runId: string | null; blocks: Array<{ kind: string }> }>;
  }>(page, "threads/get", { botId });
  expect(
    snapshot.messages
      .filter((message) => message.runId === runId)
      .flatMap((message) => message.blocks)
      .filter((block) => block.kind !== "steps"),
  ).toEqual([]);
  const transcript = page.getByTestId("transcript");
  await expect(transcript.getByText("NO_RESPONSE", { exact: false })).toHaveCount(0);
  await expect(transcript.getByText("Checking for changes.", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Agent computer", exact: true }).click();
  await page.getByRole("button", { name: /Quiet release check/ }).click();
  await expect(
    page.getByTestId("routine-run-history").getByText("Done", { exact: true }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "routine-unchanged-silent");
});
