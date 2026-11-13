/** Migration-owner only. Guest browser capabilities never obtain database access. */
export const eventDemoSchemaSql = `
CREATE TABLE IF NOT EXISTS economic_demo_campaigns (
  id TEXT PRIMARY KEY, starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL,
  max_guests INTEGER NOT NULL CHECK(max_guests BETWEEN 1 AND 50),
  grant_microunits BIGINT NOT NULL CHECK(grant_microunits=200000),
  config_digest TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS economic_demo_guests (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES economic_demo_campaigns(id),
  account_id TEXT NOT NULL UNIQUE REFERENCES api_accounts(user_id),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
  enrollment_hash TEXT NOT NULL, device_kind TEXT NOT NULL,
  worker_id TEXT, joined_at BIGINT NOT NULL, last_seen_at BIGINT NOT NULL,
  UNIQUE(campaign_id,ordinal), UNIQUE(campaign_id,enrollment_hash)
);
CREATE INDEX IF NOT EXISTS economic_demo_guests_campaign ON economic_demo_guests(campaign_id);
REVOKE ALL ON economic_demo_campaigns,economic_demo_guests FROM PUBLIC;
ALTER TABLE economic_demo_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_demo_guests ENABLE ROW LEVEL SECURITY;
`;
export function eventDemoAccessSql(role: string): string {
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(role)) throw new Error("demo_runtime_role_invalid");
  return ["economic_demo_campaigns", "economic_demo_guests"].map(table => `
    DO $access$ DECLARE r text; BEGIN
      FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON ${table} FROM %I',r);
      END LOOP;
    END;$access$;
    DROP POLICY IF EXISTS demo_native_access ON ${table};
    CREATE POLICY demo_native_access ON ${table} TO "${role}" USING (true) WITH CHECK (true);
    GRANT SELECT,INSERT,UPDATE ON ${table} TO "${role}";`).join("\n");
}
