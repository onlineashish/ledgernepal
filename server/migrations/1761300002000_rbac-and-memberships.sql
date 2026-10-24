-- Up Migration

CREATE TABLE roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  rank       INT NOT NULL CHECK (rank > 0),
  is_system  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id        UUID NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id  UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Membership: which user belongs to which business with which role.
CREATE TABLE business_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id         UUID NOT NULL REFERENCES roles (id),
  is_owner        BOOLEAN NOT NULL DEFAULT false,  -- maintained by trigger from the role; never set by hand
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  invited_by      UUID REFERENCES users (id),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at  TIMESTAMPTZ,
  deactivated_by  UUID REFERENCES users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id),
  UNIQUE (business_id, id),   -- target for composite foreign keys
  CHECK ((status = 'deactivated') = (deactivated_at IS NOT NULL))
);
CREATE INDEX business_users_user_idx ON business_users (user_id);
-- At most one active Owner per business, enforced by the database itself.
CREATE UNIQUE INDEX business_users_one_active_owner_idx
  ON business_users (business_id) WHERE is_owner AND status = 'active';

CREATE FUNCTION sync_business_user_is_owner() RETURNS trigger AS $$
BEGIN
  NEW.is_owner := (SELECT key = 'owner' FROM roles WHERE id = NEW.role_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER business_users_sync_owner BEFORE INSERT OR UPDATE OF role_id ON business_users
  FOR EACH ROW EXECUTE FUNCTION sync_business_user_is_owner();
CREATE TRIGGER business_users_updated_at BEFORE UPDATE ON business_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-member grant/deny on top of the role's default permissions.
CREATE TABLE business_user_permission_overrides (
  business_id       UUID NOT NULL,
  business_user_id  UUID NOT NULL,
  permission_id     UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  effect            TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  granted_by        UUID REFERENCES users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_user_id, permission_id),
  FOREIGN KEY (business_id, business_user_id)
    REFERENCES business_users (business_id, id) ON DELETE CASCADE
);

CREATE TABLE invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  email        CITEXT NOT NULL,
  role_id      UUID NOT NULL REFERENCES roles (id),
  token_hash   TEXT NOT NULL UNIQUE,
  invited_by   UUID NOT NULL REFERENCES users (id),
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invitations_business_idx ON invitations (business_id);
-- Only one open invitation per email per business.
CREATE UNIQUE INDEX invitations_one_open_idx ON invitations (business_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Down Migration
DROP TABLE invitations;
DROP TABLE business_user_permission_overrides;
DROP TABLE business_users;
DROP FUNCTION sync_business_user_is_owner();
DROP TABLE role_permissions;
DROP TABLE permissions;
DROP TABLE roles;
