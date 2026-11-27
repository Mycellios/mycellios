/**
 * Migration-owner only. Guest chat stores counters and keyed digests, never request
 * or response content and never a raw network address.
 */
export const guestChatSchemaSql = `
CREATE TABLE IF NOT EXISTS guest_chat_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL UNIQUE,
  challenge_hash TEXT NOT NULL UNIQUE,
  prefix_digest TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0 CHECK(messages >= 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','closed'))
);
CREATE INDEX IF NOT EXISTS guest_chat_sessions_prefix ON guest_chat_sessions(prefix_digest, created_at);
CREATE TABLE IF NOT EXISTS guest_chat_usage (
  bucket BIGINT NOT NULL,
  scope TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  PRIMARY KEY(bucket, scope)
);
REVOKE ALL ON guest_chat_sessions,guest_chat_usage FROM PUBLIC;
ALTER TABLE guest_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_chat_usage ENABLE ROW LEVEL SECURITY;
`;

export function guestChatAccessSql(role: string): string {
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(role)) throw new Error("guest_chat_runtime_role_invalid");
  return ["guest_chat_sessions", "guest_chat_usage"].map(table => `
    DO $access$ DECLARE r text; BEGIN
      FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON ${table} FROM %I',r);
      END LOOP;
    END;$access$;
    DROP POLICY IF EXISTS guest_chat_native_access ON ${table};
    CREATE POLICY guest_chat_native_access ON ${table} TO "${role}" USING (true) WITH CHECK (true);
    GRANT SELECT,INSERT,UPDATE ON ${table} TO "${role}";`).join("\n");
}
