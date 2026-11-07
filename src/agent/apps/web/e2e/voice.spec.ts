import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, rpc, signup } from "./helpers";

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["microphone"],
});

test("mobile dictation displays interim words, survives a pause and waits for Send", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/fixtures/voice-composer.html?simulated&live");
  const draft = page.getByRole("combobox", { name: "Message Chief" });
  await draft.fill("Draft:");
  await page.getByRole("button", { name: "Dictate message" }).click();
  await page.getByRole("button", { name: "First words" }).click();
  await expect(draft).toHaveValue("Draft: first guess");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Correct words" }).click();
  await expect(draft).toHaveValue("Draft: first phrase");
  await page.getByRole("button", { name: "Pause recognizer" }).click();
  await page.getByRole("button", { name: "More words" }).click();
  await expect(draft).toHaveValue("Draft: first phrase second phrase");
  await captureScreenshot(page, testInfo, "mobile-live-transcript");
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(draft).toHaveValue("Draft: first phrase second phrase final words");
  await expect(draft).toBeEditable();
  await expect(page.getByTestId("sent-voice")).toBeEmpty();
});

test("mobile voice composer keeps editable dictation and playable audio until Send", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined });
  });
  const transcriptions: string[] = [];
  await page.route("**/api/voice/transcribe", route => {
    const body = route.request().postDataJSON();
    expect(body.audioBase64.length).toBeGreaterThan(10);
    transcriptions.push(body.mimeType);
    return route.fulfill({ json: { text: "voice words" } });
  });
  await page.goto("/e2e/fixtures/voice-composer.html");
  const draft = page.getByRole("combobox", { name: "Message Chief" });
  const sent = page.getByTestId("sent-voice");
  await draft.fill("Existing draft");
  await page.getByRole("button", { name: "Dictate message" }).click();
  await expect(page.getByTestId("composer-voice-strip")).toBeVisible();
  await captureScreenshot(page, testInfo, "inline-dictation-mobile");
  await expect(page.getByTestId("composer-voice-strip")).toContainText("0:01");
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(draft).toHaveValue("Existing draft voice words");
  await expect(sent).toBeEmpty();

  await page.getByRole("button", { name: "Add to message" }).click();
  await page.getByRole("menuitem", { name: "Record voice message" }).click();
  await expect(page.getByTestId("composer-voice-strip")).toBeVisible();
  // The fake microphone must produce at least one media packet.
  await expect(page.getByTestId("composer-voice-strip")).toContainText("0:01");
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => page.locator("audio").evaluate(audio => (audio as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  await expect(draft).toHaveValue("Existing draft voice words voice words");
  await expect(sent).toBeEmpty();
  await draft.fill("Edited transcript");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(sent).toHaveText(/^Edited transcript \| audio\/(mp4|ogg|wav)$/);
  expect(transcriptions).toHaveLength(2);
});

test("voice settings hide self-hosted speech when the deployment omits it", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `voice-cloud-${stamp}@rakazo.test`, "password12", `Voice Cloud ${stamp}`);
  await completeOnboarding(page);
  // The E2E server opts into private endpoints; model the cloud catalog for this screen.
  await page.route("**/rpc/voice/catalog", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Array<{ id: string }> };
    body.json = body.json.filter((entry) => entry.id !== "openai-compatible");
    await route.fulfill({ response, json: body });
  });
  await openUserSettings(page, "voice");
  const settings = page.getByTestId("voice-settings");
  await expect(settings.getByRole("option", { name: /ElevenLabs/ })).toHaveCount(1);
  await expect(settings.getByRole("option", { name: /Self-hosted/ })).toHaveCount(0);
  await expect(settings.getByLabel("Server URL", { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "voice-settings-cloud-providers");
});

test("voice settings connect a key, speak a reply, and open a call", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined });
  });
  const stamp = Date.now();
  const userName = `Voice ${stamp}`;
  await signup(page, `voice-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);

  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Dictate message", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByTestId("call-button")).toHaveAccessibleName("Call");
  await captureScreenshot(page, testInfo, "voice-composer");
  await page.getByTestId("call-button").click();
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-settings");
  await page.getByRole("button", { name: "Close voice settings" }).click();
  await expect(page.getByTestId("voice-settings")).toHaveCount(0);

  const preparedOff = await rpc<{ ready: boolean }>(page, "voice/prepare", {
    text: "Hello there.",
  });
  expect(preparedOff.ready).toBe(false);

  await openUserSettings(page, "voice");
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await page.getByLabel("Provider", { exact: true }).selectOption({ label: "Scripted" });
  const apiKeyInput = page.getByPlaceholder(/Paste your API key/);
  await expect(apiKeyInput).toHaveAttribute("autocomplete", "new-password");
  await apiKeyInput.fill("fake-scripted-voice-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replace key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-settings-connected");

  const spoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await page.getByRole("button", { name: "Hear a sample" }).click();
  const clip = await spoken;
  expect(clip.headers()["content-type"]).toContain("audio/mpeg");

  const credentials = await rpc<Array<{ hasKey: boolean; provider: string }>>(
    page,
    "voice/credentials",
    {},
  );
  expect(credentials).toEqual([expect.objectContaining({ hasKey: true, provider: "scripted" })]);
  expect(JSON.stringify(credentials)).not.toContain("fake-scripted-voice-key");

  await page.getByRole("button", { name: "Close voice settings" }).click();

  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("say hello");
  await page.keyboard.press("Enter");
  // A reply can render more than one text bubble; speak the latest one.
  const speakReply = page.getByRole("button", { name: "Speak this reply" }).last();
  await expect(speakReply).toBeVisible({
    timeout: 30_000,
  });

  const replySpoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await speakReply.click();
  await replySpoken;

  await page.route("**/api/voice/speak", (route) =>
    route.fulfill({
      status: 402,
      contentType: "application/json",
      body: JSON.stringify({ error: "Insufficient credit", code: "VOICE_OUT_OF_CREDIT" }),
    }),
  );
  await speakReply.click();
  await expect(page.getByText("Your voice provider is out of credit.")).toBeVisible();
  await captureScreenshot(page, testInfo, "read-aloud-out-of-credit");
  await page.unroute("**/api/voice/speak");

  await openUserSettings(page, "voice");
  await expect(page.getByRole("button", { name: "Replace key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close voice settings" }).click();

  await page.getByTestId("call-button").click();
  await expect(page.getByTestId("call-view")).toBeVisible();
  await expect(page.getByTestId("call-view").getByText("Calling…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hang up" })).toBeVisible();
  await captureScreenshot(page, testInfo, "outgoing-ringing");
  await expect(page.getByTestId("call-view").getByText("Listening", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-call");
  await page.getByRole("button", { name: "Minimize call" }).click();
  await expect(page.getByTestId("call-view")).toHaveCount(0);
  await expect(page.getByTestId("call-button")).toHaveAccessibleName("Open call");
  await captureScreenshot(page, testInfo, "call-minimized");
  await page.getByTestId("call-return-bar").click();
  await expect(page.getByTestId("call-view")).toBeVisible();
  await page.getByRole("button", { name: "Hang up" }).click();
  await expect(page.getByTestId("call-view")).toHaveCount(0);
  await expect(page.getByTestId("call-return-bar")).toHaveCount(0);

  // The out-of-credit toast sits over the mic; let it close so the press reaches the mic.
  await expect(page.getByText("Your voice provider is out of credit.")).toHaveCount(0);
  const mic = page.getByRole("button", { name: "Dictate message", exact: true });
  await mic.click();
  await expect(page.getByTestId("composer-voice-strip")).toBeVisible();
  await captureScreenshot(page, testInfo, "composer-mic-dictation");
  await page.getByRole("button", { name: "Discard recording" }).click();
  await expect(page.getByTestId("composer-voice-strip")).toHaveCount(0);

  await openUserSettings(page, "voice");
  const settings = page.getByTestId("voice-settings");
  await settings.getByPlaceholder(/Paste a replacement key/).fill("leftover-voice-key");
  await settings.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Disconnect", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await expect(settings.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(rpc<Array<{ provider: string }>>(page, "voice/credentials", {})).resolves.toEqual(
    [],
  );
});

test("voice settings take a self-hosted speech server by URL", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `voice-local-${stamp}@rakazo.test`, "password12", `Voice Local ${stamp}`);
  await completeOnboarding(page);

  await openUserSettings(page, "voice");
  const settings = page.getByTestId("voice-settings");
  await expect(settings).toBeVisible();
  const providerSelect = settings.getByLabel("Provider", { exact: true });
  await expect(providerSelect).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-settings-providers");
  await providerSelect.selectOption({ label: "Self-hosted" });
  await expect(settings.getByLabel("API key", { exact: true })).toHaveAttribute(
    "placeholder",
    "Optional",
  );
  const connect = settings.getByRole("button", { name: "Connect", exact: true });
  await expect(connect).toBeDisabled();
  await captureScreenshot(page, testInfo, "voice-settings-self-hosted-empty");

  // Nothing listens on the discard port, so the server check fails without a network.
  await settings.getByLabel("Server URL", { exact: true }).fill("http://127.0.0.1:9");
  await settings.getByLabel("Speech model", { exact: true }).fill("kokoro");
  await settings.getByLabel("Transcription model", { exact: true }).fill("whisper-1");
  await expect(connect).toBeEnabled();
  await captureScreenshot(page, testInfo, "voice-settings-self-hosted");
  await connect.click();
  await expect(
    settings.getByText("Couldn't reach the speech server at http://127.0.0.1:9."),
  ).toBeVisible();

  const credentials = await rpc<unknown[]>(page, "voice/credentials");
  expect(credentials).toEqual([]);
});
