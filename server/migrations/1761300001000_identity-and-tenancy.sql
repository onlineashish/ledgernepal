-- Up Migration

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                CITEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  phone                TEXT,
  is_platform_admin    BOOLEAN NOT NULL DEFAULT false,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  email_verified_at    TIMESTAMPTZ,
  failed_login_count   INT NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until         TIMESTAMPTZ,
  password_changed_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------- businesses
CREATE TABLE businesses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL CHECK (length(trim(name)) > 0),
  legal_name         TEXT,
  address            TEXT,
  phone              TEXT,
  email              CITEXT,
  pan_number         TEXT,
  vat_number         TEXT,
  is_vat_registered  BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_by         UUID REFERENCES users (id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE business_settings (
  business_id          UUID PRIMARY KEY REFERENCES businesses (id) ON DELETE CASCADE,
  date_display         TEXT NOT NULL DEFAULT 'BS' CHECK (date_display IN ('BS', 'AD')),
  -- No VAT rate is assumed: NULL until the owner configures one.
  default_vat_rate     NUMERIC(5, 2) CHECK (default_vat_rate BETWEEN 0 AND 100),
  prices_include_vat   BOOLEAN NOT NULL DEFAULT false,
  default_credit_days  INT CHECK (default_credit_days >= 0),
  sale_prefix          TEXT NOT NULL DEFAULT 'SI',
  purchase_prefix      TEXT NOT NULL DEFAULT 'PB',
  receipt_prefix       TEXT NOT NULL DEFAULT 'RC',
  payment_prefix       TEXT NOT NULL DEFAULT 'PM',
  ledger_prefix        TEXT NOT NULL DEFAULT 'LE',
  opening_prefix       TEXT NOT NULL DEFAULT 'OB',
  invoice_footer       TEXT,
  updated_by           UUID REFERENCES users (id),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER business_settings_updated_at BEFORE UPDATE ON business_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------- sessions
CREATE TABLE sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          TEXT NOT NULL UNIQUE,   -- SHA-256 of the cookie token; the raw token is never stored
  csrf_token          TEXT NOT NULL,
  user_id             UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  active_business_id  UUID REFERENCES businesses (id) ON DELETE SET NULL,
  ip                  INET,
  user_agent          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

-- Down Migration
DROP TABLE password_reset_tokens;
DROP TABLE sessions;
DROP TABLE business_settings;
DROP TABLE businesses;
DROP TABLE users;
