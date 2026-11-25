/**
 * Where a self-hosted Mycellios comes from (specs/trusted-distribution, phase 1). The root workflow
 * `.github/workflows/self-host-images.yml` builds these images only from this repository's `main`,
 * tags each one `sha-<full commit>`, moves `edge` to the newest main commit and adds `v<version>`
 * once a Desktop release of that commit is public. The installer, the Compose files, the updater
 * and Desktop's Docker stack all default to them.
 */
export const SELF_HOST_REPOSITORY_URL = "https://github.com/Mycellios/mycellios";
export const SELF_HOST_IMAGE_NAMESPACE = "ghcr.io/mycellios/mycellios";
export const SELF_HOST_APP_IMAGE = `${SELF_HOST_IMAGE_NAMESPACE}/app`;
export const SELF_HOST_COMPUTER_IMAGE = `${SELF_HOST_IMAGE_NAMESPACE}/computer`;
export const SELF_HOST_UPDATER_IMAGE = `${SELF_HOST_IMAGE_NAMESPACE}/updater`;

/**
 * The registry namespace of the project Mycellios Agent was imported from. Installs created before
 * this repository published its own images still name images under it in `.env`; they keep them
 * until their owner moves, and nothing here pulls this repository's tags from it.
 */
export const UPSTREAM_IMAGE_OWNER = "ghcr.io/elie222/";

/**
 * Before an install moves to these images, the target app image lists the migrations its database
 * records that the image does not ship. A database migrated by a newer release of the project
 * Mycellios Agent was imported from would otherwise stop the new API at startup. The command runs
 * in a one-off `api` container (it needs the database login that service receives) and exits with
 * {@link MIGRATION_HISTORY_UNKNOWN_EXIT} when the move must be refused; any other non-zero exit
 * means the check itself failed, which refuses the move as well.
 */
export const MIGRATION_HISTORY_COMMAND = [
  "node",
  "/app/apps/api/dist/cli/check-migration-history.js",
] as const;
export const MIGRATION_HISTORY_UNKNOWN_EXIT = 3;
