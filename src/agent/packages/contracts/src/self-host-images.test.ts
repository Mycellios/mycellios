import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIGRATION_HISTORY_COMMAND,
  MIGRATION_HISTORY_UNKNOWN_EXIT,
  SELF_HOST_APP_IMAGE,
  SELF_HOST_COMPUTER_IMAGE,
  SELF_HOST_IMAGE_NAMESPACE,
  SELF_HOST_REPOSITORY_URL,
  SELF_HOST_UPDATER_IMAGE,
  UPSTREAM_IMAGE_OWNER,
} from "./self-host-images.js";

const agent = path.resolve(import.meta.dirname, "../../..");

describe("self-host image identity", () => {
  it("names the images the repository's own workflow publishes", () => {
    const repository = new URL(SELF_HOST_REPOSITORY_URL).pathname.slice(1).toLowerCase();
    expect(SELF_HOST_IMAGE_NAMESPACE).toBe(`ghcr.io/${repository}`);
    for (const image of [SELF_HOST_APP_IMAGE, SELF_HOST_COMPUTER_IMAGE, SELF_HOST_UPDATER_IMAGE]) {
      expect(image.startsWith(`${SELF_HOST_IMAGE_NAMESPACE}/`)).toBe(true);
      expect(image.startsWith(UPSTREAM_IMAGE_OWNER)).toBe(false);
    }
    expect(UPSTREAM_IMAGE_OWNER.endsWith("/")).toBe(true);
  });

  it("runs a migration check that the app image actually contains", () => {
    // The API build bundles the CLI to dist/cli, and the image links /app to the Agent tree.
    const build = JSON.parse(readFileSync(path.join(agent, "apps/api/package.json"), "utf8"))
      .scripts.build as string;
    expect(build.split(" ")).toContain("src/cli/check-migration-history.ts");
    expect(readFileSync(path.join(agent, "infra/compose/Dockerfile"), "utf8")).toContain(
      "ln -s /repo/src/agent /app",
    );
    expect(MIGRATION_HISTORY_COMMAND).toEqual([
      "node",
      "/app/apps/api/dist/cli/check-migration-history.js",
    ]);
    // Exit statuses Compose and Node use for their own failures must not read as a refusal.
    expect([0, 1, 2, 125, 126, 127]).not.toContain(MIGRATION_HISTORY_UNKNOWN_EXIT);
  });
});
