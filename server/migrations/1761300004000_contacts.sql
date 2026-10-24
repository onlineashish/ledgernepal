-- Up Migration

-- A person or company a business deals with. Contacts never log in.
-- Phone, PAN and VAT are deliberately NOT unique: real businesses share numbers and
-- reuse placeholders, and no business rule requires uniqueness (requirements §5).
CREATE TABLE contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_customer  BOOLEAN NOT NULL DEFAULT false,
  is_supplier  BOOLEAN NOT NULL DEFAULT false,
  is_partner   BOOLEAN NOT NULL DEFAULT false,
  phone        TEXT,
  email        CITEXT,
  address      TEXT,
  pan_number   TEXT,
  vat_number   TEXT,
  notes        TEXT,
  archived_at  TIMESTAMPTZ,
  archived_by  UUID REFERENCES users (id),
  created_by   UUID NOT NULL REFERENCES users (id),
  updated_by   UUID REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- "Multiple roles" = several of these true; at least one is required.
  CHECK (is_customer OR is_supplier OR is_partner),
  CHECK ((archived_at IS NULL) = (archived_by IS NULL)),
  -- Target of composite foreign keys, so transactions can never point at another business's contact.
  UNIQUE (business_id, id)
);
CREATE INDEX contacts_business_name_idx ON contacts (business_id, lower(name), id);
CREATE INDEX contacts_name_trgm_idx ON contacts USING gin (name gin_trgm_ops);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE contacts;
