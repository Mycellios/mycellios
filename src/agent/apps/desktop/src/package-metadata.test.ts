import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
) as {
  productName?: string;
  build?: { productName?: string; appId?: string; beforePack?: string; nsis?: {deleteAppDataOnUninstall?:boolean} };
};

describe("desktop package metadata", () => {
  it("shares the customer-facing name between Electron and electron-builder", () => {
    expect(packageJson.productName).toBe("Mycellios Desktop");
    expect(packageJson.build?.productName).toBeUndefined();
  });
  it("keeps the upgrade identity and profile and checks fresh release inputs before packaging", () => {
    expect(packageJson.build?.appId).toBe("com.mycellios.agent.desktop");
    expect(packageJson.build?.nsis?.deleteAppDataOnUninstall).toBe(false);
    expect(packageJson.build?.beforePack).toBe("./scripts/verify-release.cjs");
    const main = readFileSync(path.resolve(import.meta.dirname,"main.ts"),"utf8");
    expect(main).toContain('app.setPath("userData", path.join(app.getPath("appData"), "Mycellios Agent"))');
  });
});
