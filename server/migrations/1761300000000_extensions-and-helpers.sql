-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fast contact search (used in Phase 4)

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
DROP FUNCTION set_updated_at();
-- Extensions are intentionally left installed on rollback.
