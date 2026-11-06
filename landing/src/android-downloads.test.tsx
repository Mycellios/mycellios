import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { isAndroidDownload } from "../../src/contracts/android-downloads";
import { AndroidDownload } from "./AndroidDownload";
const valid = { schema:"mycellios-android-download/1", version:"1.0.0", versionCode:1, applicationId:"com.mycellios.android", minSdk:26, fileName:"Mycellios-Android-1.0.0.apk", path:"/downloads/android/releases/1.0.0/Mycellios-Android-1.0.0.apk", sourcePath:"/downloads/android/releases/1.0.0/source.tar.gz", bytes:100,sha256:"a".repeat(64),signerSha256:"b".repeat(64),revision:"c".repeat(40),tree:"d".repeat(40),automaticUpdates:false };
it("admits only an owned versioned APK with source and signer identity",()=>{
 expect(isAndroidDownload(valid)).toBe(true);
 for(const change of [{path:"https://evil.example/a.apk"},{path:"/downloads/android/releases/1.0.0/../a.apk"},{signerSha256:"debug"},{applicationId:"com.mycellios.agent"},{automaticUpdates:true},{bytes:NaN}])expect(isAndroidDownload({...valid,...change})).toBe(false);
});
it("exposes Android voice and manual install guidance without inventing an available release",()=>{
 const html=renderToStaticMarkup(<AndroidDownload/>);
 expect(html).toContain("Download for Android");expect(html).toContain("disabled");
 expect(html).toContain("Quick Tap");expect(html).toContain("screen on");
 expect(html).toContain("Updates are manual");expect(html).not.toContain('href="/downloads/android/releases');
});
