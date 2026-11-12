/** Apply with the migration owner, never with a browser or runtime DDL credential. */
export const browserInferenceCreditsSchemaSql = `
CREATE TABLE IF NOT EXISTS economic_browser_contributors (
  worker_id TEXT PRIMARY KEY, browser_id TEXT NOT NULL, credential_fingerprint TEXT NOT NULL,
  account_id TEXT NOT NULL, linked_at BIGINT NOT NULL, revoked_at BIGINT
);
CREATE TABLE IF NOT EXISTS economic_browser_inference_credits (
  usage_id TEXT PRIMARY KEY REFERENCES economic_managed_purchases(usage_id),
  worker_id TEXT NOT NULL REFERENCES economic_browser_contributors(worker_id),
  account_id TEXT NOT NULL, amount_microunits BIGINT NOT NULL CHECK(amount_microunits > 0),
  receipt_digest TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS economic_browser_credits_account ON economic_browser_inference_credits(account_id);
CREATE INDEX IF NOT EXISTS economic_browser_pending ON economic_managed_purchases(created_at)
  WHERE provider='mycellios-browser' AND state IN ('reserved','submitted','uncertain');
REVOKE ALL ON economic_browser_contributors,economic_browser_inference_credits FROM PUBLIC;
ALTER TABLE economic_browser_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_browser_inference_credits ENABLE ROW LEVEL SECURITY;
`;

export function browserInferenceCreditsAccessSql(role: string): string {
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(role)) throw new Error("browser_runtime_role_invalid");
  return ["economic_browser_contributors", "economic_browser_inference_credits"].map(table => `
    DO $access$ DECLARE r text; BEGIN
      FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON ${table} FROM %I',r);
      END LOOP;
    END;$access$;
    DROP POLICY IF EXISTS browser_native_access ON ${table};
    CREATE POLICY browser_native_access ON ${table} TO "${role}" USING (true) WITH CHECK (true);
    GRANT SELECT,INSERT${table === "economic_browser_contributors" ? ",UPDATE" : ""} ON ${table} TO "${role}";`).join("\n");
}
