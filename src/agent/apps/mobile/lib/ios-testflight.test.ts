import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../..");
const workflow = readFileSync(path.join(root, ".github/workflows/ios-testflight.yml"), "utf8");
const easConfig = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../eas.json"), "utf8"),
) as {
  build: Record<
    string,
    { distribution?: string; environment?: string; ios?: { simulator?: boolean } }
  >;
  submit: Record<string, { ios?: Record<string, string> }>;
};
const app = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../app.json"), "utf8")) as {
  expo: {
    name: string;
    scheme: string;
    updates: { enabled: boolean };
    ios: { bundleIdentifier: string; config: { usesNonExemptEncryption: boolean } };
  };
};

describe("iOS TestFlight release", () => {
  it("keeps the inherited native app and a store build for com.mycellios.agent", () => {
    expect(app.expo.name).toBe("Mycellios Agent");
    expect(app.expo.scheme).toBe("rakazo");
    expect(app.expo.ios.bundleIdentifier).toBe("com.mycellios.agent");
    expect(app.expo.ios.config.usesNonExemptEncryption).toBe(false);
    expect(app.expo.updates.enabled).toBe(false);
    expect(easConfig.build.testflight).toMatchObject({
      distribution: "store",
      environment: "production",
      ios: { simulator: false },
    });
    expect(easConfig.submit.testflight?.ios).toEqual({});
    expect(JSON.stringify(easConfig)).not.toMatch(/ascAppId|ascApiKey|appleTeamId|BEGIN PRIVATE/);
  });

  it("uploads from main only after a person supplies Apple and Expo secrets", () => {
    expect(workflow).toContain("\non:\n  workflow_dispatch:\n");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("eas-cli@27.10.0");
    expect(workflow).toContain("--profile testflight");
    expect(workflow).toContain("eas submit --platform ios --profile testflight");
    expect(workflow).not.toContain("eas submit --platform ios --profile production --latest");
    for (const name of [
      "EXPO_TOKEN",
      "ASC_APP_ID",
      "ASC_KEY_ID",
      "ASC_ISSUER_ID",
      "ASC_PRIVATE_KEY",
    ]) {
      expect(workflow).toContain(name);
    }
    const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences)
      expect(reference, reference).toMatch(/@[0-9a-f]{40}$/);
  });
});
