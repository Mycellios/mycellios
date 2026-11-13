const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// A cold download edge can initially ignore Range and send the full installer.
// Close that response immediately; only an exact 206 response qualifies release.
export async function verifyPublicInstallerRange(file, { fetchImpl = fetch, sleep = pause } = {}) {
  if (typeof file.path !== 'string' || !file.path.startsWith('/downloads/') || !Number.isSafeInteger(file.bytes) || file.bytes < 1024) {
    throw Error('Invalid download route or size');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchImpl('https://www.mycellios.com' + file.path, {
      headers: { Range: 'bytes=0-1023', 'User-Agent': 'MycelliosInstallerPublisher/1' },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 200) {
      await response.body?.cancel();
      if (attempt < 2) { await sleep(1000); continue; }
      throw Error(`Public download ignored Range after 3 attempts: ${file.path}`);
    }
    if (response.status !== 206 || response.headers.get('content-range') !== `bytes 0-1023/${file.bytes}` || !response.body) {
      await response.body?.cancel();
      throw Error(`Actual public download failed (${response.status}): ${file.path}`);
    }
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024) throw Error('Public range exceeded its admitted size');
      }
      if (bytes !== 1024) throw Error('Public range was truncated');
    } finally { await reader.cancel(); }
    return;
  }
}
