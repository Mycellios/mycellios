import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isAndroidDownload, type AndroidDownload as Release } from "../../src/contracts/android-downloads";
import { Button, Disclosure, DisclosureSummary, Heading, Link, Text } from "./ui/primitives";

/** Android has its own signed catalog; existing Desktop releases remain independent. */
export function AndroidDownload() {
  const [release, setRelease] = useState<Release | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true; setFailed(false);
    void fetch("/downloads/android/latest.json", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      .then(async response => { if (!response.ok) throw Error("Unavailable"); const body: unknown = await response.json(); if (!isAndroidDownload(body)) throw Error("Invalid release"); if (active) setRelease(body); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  return <section aria-labelledby="android-title">
    <Heading as="h2" id="android-title">Mycellios for Android</Heading>
    <Text>The same Mycellios, with native voice dictation.</Text>
    <div className="desktop-package">
      <div><Heading as="h3">Android</Heading><Text>Android 8 or later · APK · Internet connection required</Text></div>
      {release && !failed ? <Link variant="primary" size="lg" href={release.path} download={release.fileName} aria-label="Download for Android"><Download size={18} aria-hidden="true" />Download</Link> : <Button variant="primary" size="lg" disabled aria-label="Download for Android">{failed ? "Unavailable" : "Checking…"}</Button>}
    </div>
    {failed ? <div role="alert"><Text>Android downloads could not be checked.</Text><Button onClick={() => setAttempt(v => v + 1)}>Try again</Button></div> : null}
    {release ? <Text className="desktop-version">Version {release.version} · {Math.ceil(release.bytes / 1_000_000)} MB</Text> : null}
    <Disclosure className="desktop-details ui-animated-disclosure"><DisclosureSummary>Android installation &amp; voice</DisclosureSummary><div className="ui-disclosure-body">
      <Text>Download the APK and open it. Android may ask you to allow installation from your browser. Sign in with your existing Mycellios account; your Micos, models and chats are kept.</Text>
      <Text>On Pixel, open Settings → System → Gestures → Quick Tap → Open app, choose Mycellios and its Dictate shortcut. Use it with the phone unlocked and the screen on. Other Android phones can use the app's Dictate shortcut when their launcher or gesture settings support it.</Text>
      <Text>Your words remain editable. Review, continue and send when you are ready. Dictation stops when the app goes into the background. Android's speech service handles recognition and may need a connection.</Text>
      <Text>Updates are manual: install the newer Mycellios APK over this app to keep its local data. Keep Android System WebView or Chrome updated. This download is signed by Mycellios and is not yet distributed through Google Play.</Text>
      {release ? <div className="desktop-checksums"><Text>APK SHA-256<code>{release.sha256}</code>Signing certificate SHA-256<code>{release.signerSha256}</code></Text><Link href={release.sourcePath}>Android source code and build information</Link></div> : null}
    </div></Disclosure>
  </section>;
}
