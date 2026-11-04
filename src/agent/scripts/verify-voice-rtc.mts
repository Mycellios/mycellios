/** Local transport qualification only: scripted speech/agent, never a real account. */
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { Hono } from "hono";
import { mountRtcVoiceTrial } from "../apps/api/src/voice-rtc/http.js";
import { pcmToMuLaw, wav8k } from "../apps/api/src/voice-rtc/pcm.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = path.resolve(process.argv[2] ?? path.join(root, "test-results/voice-rtc"));
await mkdir(evidence, { recursive: true });
const wav = path.join(evidence, "synthetic-microphone.wav");
await writeFile(
  wav,
  wav8k(
    Array.from({ length: 8_000 * 4 }, (_, index) =>
      index < 8_000 ? Math.round(Math.sin((index * Math.PI) / 10) * 12_000) : 0,
    ),
  ),
);
const bundle = await build({
  stdin: {
    contents: `import {RtcVoiceTrial} from ${JSON.stringify(path.join(root, "apps/web/src/lib/rtc-voice-mvp.ts"))};
    window.events=[]; window.client=new RtcVoiceTrial({botId:'fixture-mico'},'fixture-space',event=>{window.events.push(event);document.querySelector('#state').textContent=event.phase??event.type;});
    document.querySelector('#start').onclick=()=>window.client.start().catch(error=>{document.querySelector('#state').textContent=error.message;});
    document.querySelector('#stop').onclick=()=>window.client.stop();`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "import.meta.env.BASE_URL": JSON.stringify("/") },
  plugins: [
    {
      name: "isolated-fixture-session",
      setup(build) {
        build.onResolve({ filter: /^\.\/rpc$/ }, (args) =>
          args.importer.endsWith("rtc-voice-mvp.ts")
            ? { path: "fixture-rpc", namespace: "fixture" }
            : undefined,
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export function withSpaceHeaders(init,space){const h=new Headers(init);if(space)h.set('x-rakazo-space-id',space);return h}`,
          loader: "js",
        }));
      },
    },
  ],
});
const app = new Hono();
let origin = "";
let accepted = 0;
const stopRtc = mountRtcVoiceTrial(app, {
  authenticate: async (request) =>
    request.headers.get("cookie")?.includes("voice-trial=fixture")
      ? ({ userId: "fixture-user", spaceId: "fixture-space" } as never)
      : null,
  trustedOrigin: (value) => value === origin,
  makeMico: (_actor, _request, target) => {
    assert.equal(target.botId, "fixture-mico");
    return {
      validate: async () => {},
      transcribe: async () => "Synthetic local transport test",
      reply: async () => {
        accepted++;
        return "This is the isolated transport fixture, not your account.";
      },
      speak: async () =>
        pcmToMuLaw(
          Int16Array.from({ length: 8_000 }, (_, index) =>
            Math.round(Math.sin((index * Math.PI) / 10) * 10_000),
          ),
        ),
    };
  },
});
app.get("/fixture.js", (c) =>
  c.body(bundle.outputFiles![0]!.text, 200, { "content-type": "text/javascript" }),
);
app.get("/", (c) =>
  c.html(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mycellios voice transport lab</title>
  <body style="font:16px system-ui;max-width:560px;margin:40px auto;padding:20px;background:#f8f5ef;color:#202d25">
  <h1>Local voice transport test</h1><p>Scripted Mico fixture. No production account, credentials or data.</p>
  <button id="start">Start voice trial</button> <button id="stop">End call</button><p id="state" role="status">Ready</p>
  <p>Desktop automation cannot verify Android or iPhone lock-screen support.</p><script type="module" src="/fixture.js"></script></body></html>`),
);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  ...(process.argv[3] ? { executablePath: process.argv[3] } : { channel: "chrome" }),
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
  ],
});
try {
  const context = await browser.newContext({
    permissions: ["microphone"],
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies([{ name: "voice-trial", value: "fixture", url: origin }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "Start voice trial" }).click();
  await page.waitForFunction(
    () => (window as any).events.some((event: any) => event.phase === "speaking"),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1200);
  await page.evaluate(() => (window as any).client.stats());
  await page.waitForFunction(() =>
    (window as any).events.some(
      (event: any) => event.type === "stats" && event.receivedPackets > 20,
    ),
  );
  const result = await page.evaluate(async () => {
    const client = (window as any).client;
    const reports = Array.from((await client.pc.getStats()).values()) as any[];
    const inbound = reports.filter(
      (report) => report.type === "inbound-rtp" && report.kind === "audio",
    );
    return {
      diagnostic: client.diagnostic(),
      inbound: inbound.map(({ packetsReceived, totalAudioEnergy, totalSamplesReceived }) => ({
        packetsReceived,
        totalAudioEnergy,
        totalSamplesReceived,
      })),
    };
  });
  assert.ok(
    result.inbound.some(
      (report) => Number(report.packetsReceived) > 20 && Number(report.totalAudioEnergy) > 0,
    ),
  );
  await page.screenshot({
    path: path.join(evidence, "transport-chromium-mobile-viewport.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "End call" }).click();
  await page.waitForFunction(() => (window as any).client.pc.connectionState === "closed");
  const micEnded = await page.evaluate(() =>
    (window as any).client.mic
      .getTracks()
      .every((track: MediaStreamTrack) => track.readyState === "ended"),
  );
  assert.ok(micEnded);
  assert.equal(errors.length, 0);
  assert.ok(accepted >= 1);
  await writeFile(
    path.join(evidence, "chromium-transport.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        fixture: true,
        realAccount: false,
        physicalAndroid: "not-tested",
        physicalIPhone: "not-tested",
        accepted,
        micEnded,
        errors,
        ...result,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: "passed",
      transport: "real Chromium to Node WebRTC, bidirectional audible RTP",
      fixture: true,
      realAccount: false,
      physicalPhones: "not-tested",
      evidence,
    }),
  );
} finally {
  await browser.close();
  await stopRtc();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
