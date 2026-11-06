export interface AndroidDownload {
  schema: "mycellios-android-download/1";
  version: string; versionCode: number; applicationId: "com.mycellios.android";
  minSdk: number; fileName: string; path: string; sha256: string; bytes: number;
  signerSha256: string; revision: string; tree: string; sourcePath: string;
  automaticUpdates: false;
}
export function isAndroidDownload(value: unknown): value is AndroidDownload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schema !== "mycellios-android-download/1" || v.applicationId !== "com.mycellios.android" || v.automaticUpdates !== false || typeof v.version !== "string" || !/^\d+\.\d+\.\d+$/.test(v.version)) return false;
  const file = `Mycellios-Android-${v.version}.apk`, prefix = `/downloads/android/releases/${v.version}/`;
  return v.fileName === file && v.path === prefix + file && v.sourcePath === prefix + "source.tar.gz" &&
    [v.sha256, v.signerSha256].every(x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x)) &&
    [v.revision, v.tree].every(x => typeof x === "string" && /^[a-f0-9]{40}$/.test(x)) &&
    Number.isSafeInteger(v.versionCode) && Number(v.versionCode) > 0 &&
    Number.isSafeInteger(v.minSdk) && Number(v.minSdk) >= 26 && Number(v.minSdk) <= 36 &&
    Number.isSafeInteger(v.bytes) && Number(v.bytes) > 0 && Number(v.bytes) < 500_000_000;
}
