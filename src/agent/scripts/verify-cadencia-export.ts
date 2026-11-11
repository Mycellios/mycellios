import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";

const original = process.argv[2],
  edited = process.argv[3];
assert.ok(
  original && edited,
  "Provide the synthetic original and actual browser export paths.",
);
async function inspect(file: string) {
  const bytes = await readFile(file);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(new Blob([new Uint8Array(bytes)])),
  });
  try {
    const audio = await input.getPrimaryAudioTrack(),
      video = await input.getPrimaryVideoTrack();
    assert.ok(audio && video, "Both voice and picture must survive export.");
    return {
      bytes: bytes.length,
      duration: await input.computeDuration(),
      audioStart: await audio.getFirstTimestamp(),
      videoStart: await video.getFirstTimestamp(),
      audioEnd: await audio.computeDuration(),
      videoEnd: await video.computeDuration(),
      sampleRate: await audio.getSampleRate(),
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
    };
  } finally {
    input.dispose();
  }
}
const before = await inspect(original),
  after = await inspect(edited);
assert.ok(before.duration > 10.8 && before.duration < 11);
assert.ok(after.duration > 7.6 && after.duration < 7.85);
assert.ok(before.duration - after.duration > 3);
assert.ok(Math.abs(after.audioStart - after.videoStart) < 0.04);
assert.ok(Math.abs(after.audioEnd - after.videoEnd) < 0.06);
assert.equal(after.sampleRate, before.sampleRate);
assert.equal(after.width / after.height, before.width / before.height);
const receipt = {
  ok: true,
  synthetic: true,
  production: false,
  before,
  after,
  qualification:
    "Actual browser-created original and edited MP4; audio/video retained, same source sample rate/aspect, shortened duration and A/V end difference under 60 ms. Browser decode/re-import is separate evidence.",
};
await writeFile(
  "outputs/cadencia-export-receipt.json",
  JSON.stringify(receipt, null, 2),
);
console.log(JSON.stringify(receipt, null, 2));
