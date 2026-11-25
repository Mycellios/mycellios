// `node dist/cli/check-migration-history.js`, run in a one-off `api` container of the release an
// install is about to move to (specs/trusted-distribution, phase 1). It lists the migrations the
// database records that this release does not ship and exits MIGRATION_HISTORY_UNKNOWN_EXIT when
// there are any, so the installer, the updater and Desktop refuse the move instead of starting an
// API on a schema a newer release of another project created. It only reads the history table.
import path from "node:path";
import { MIGRATION_HISTORY_UNKNOWN_EXIT } from "@mycellios/contracts";
import { loadRootEnv } from "@mycellios/core/node/load-root-env";
import { databaseMigrationsMissingFrom, databaseUrls } from "@mycellios/db";

loadRootEnv();
const { migrationUrl } = databaseUrls(process.env);
const migrations = path.resolve(import.meta.dirname, "../../../../packages/db/prisma/migrations");
const unknown = await databaseMigrationsMissingFrom(migrationUrl, migrations);
if (unknown.length === 0) {
  process.stdout.write("The database records no migration this release lacks.\n");
} else {
  process.stdout.write(
    `The database records ${unknown.length} migration(s) this release does not ship:\n${unknown
      .map((name) => `  ${name}\n`)
      .join("")}`,
  );
  process.exitCode = MIGRATION_HISTORY_UNKNOWN_EXIT;
}
