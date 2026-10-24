-- Up Migration

CREATE TABLE audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  business_id    UUID,              -- NULL for platform/auth events; no FK so history outlives deletions
  actor_user_id  UUID,
  actor_ip       INET,
  request_id     TEXT,
  action         TEXT NOT NULL CHECK (length(action) > 0),   -- e.g. 'auth.login_failed', 'transaction.post'
  entity_type    TEXT,
  entity_id      UUID,
  before         JSONB,
  after          JSONB,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_business_idx ON audit_logs (business_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);

-- Append-only: no role (including the table owner) can rewrite history through UPDATE/DELETE.
CREATE FUNCTION audit_logs_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_changes();

-- Down Migration
DROP TABLE audit_logs;
DROP FUNCTION audit_logs_block_changes();
