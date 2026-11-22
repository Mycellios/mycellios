-- Apply as the primary identity database migration owner.
-- Create the private policy separately, after Agent and hosted login support the proof.
BEGIN;

CREATE SCHEMA IF NOT EXISTS mycellios_beta;
REVOKE ALL ON SCHEMA mycellios_beta FROM PUBLIC;

CREATE TABLE IF NOT EXISTS mycellios_beta.signup_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  proof_key bytea NOT NULL CHECK (octet_length(proof_key) = 32),
  capacity integer NOT NULL CHECK (capacity >= 0),
  admitted integer NOT NULL DEFAULT 0 CHECK (admitted >= 0 AND admitted <= capacity)
);
REVOKE ALL ON TABLE mycellios_beta.signup_policy FROM PUBLIC;

CREATE OR REPLACE FUNCTION mycellios_beta.admit_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  policy mycellios_beta.signup_policy%ROWTYPE;
  proof text := NEW.raw_user_meta_data ->> 'mycellios_invite_proof';
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()));
  expires bigint;
  expected bytea;
BEGIN
  SELECT * INTO policy FROM mycellios_beta.signup_policy WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF proof IS NULL OR proof !~ '^[0-9]{10}\.[a-f0-9]{64}$'
    OR NEW.email IS NULL
    OR NEW.raw_app_meta_data ->> 'provider' IS DISTINCT FROM 'email'
    OR policy.admitted >= policy.capacity
  THEN
    RAISE EXCEPTION 'Registration is closed';
  END IF;

  expires := split_part(proof, '.', 1)::bigint;
  IF expires <= now_seconds OR expires > now_seconds + 300 THEN
    RAISE EXCEPTION 'Registration is closed';
  END IF;

  expected := extensions.hmac(
    convert_to('mycellios:primary-signup:proof:v1:' || expires || ':' || lower(btrim(NEW.email)), 'UTF8'),
    policy.proof_key,
    'sha256'
  );
  IF expected <> decode(split_part(proof, '.', 2), 'hex') THEN
    RAISE EXCEPTION 'Registration is closed';
  END IF;

  UPDATE mycellios_beta.signup_policy SET admitted = admitted + 1 WHERE singleton;
  UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data - 'mycellios_invite_proof'
    WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION mycellios_beta.admit_signup() FROM PUBLIC;
DROP TRIGGER IF EXISTS mycellios_beta_admit_signup ON auth.users;
CREATE TRIGGER mycellios_beta_admit_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION mycellios_beta.admit_signup();

COMMIT;
