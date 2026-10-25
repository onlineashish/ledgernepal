-- Up Migration
-- See docs/accounting-conventions.md. Balances are never stored: they are calculated from posted rows.

-- One counter per business, kind of document and fiscal year, for gap-free reference numbers.
CREATE TABLE document_sequences (
  business_id  UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  doc_kind     TEXT NOT NULL CHECK (doc_kind IN ('ledger_entry', 'opening_balance', 'sale', 'purchase', 'receipt', 'payment')),
  fiscal_year  TEXT NOT NULL,   -- e.g. '2082/83'
  next_value   INT NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  PRIMARY KEY (business_id, doc_kind, fiscal_year)
);

CREATE TABLE transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL,
  -- Composite key: a transaction can only point at a contact of the SAME business.
  FOREIGN KEY (business_id, contact_id) REFERENCES contacts (business_id, id),

  type    TEXT NOT NULL CHECK (type IN ('opening_balance', 'ledger_entry', 'sale', 'purchase', 'receipt', 'payment')),
  status  TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'voided')),
  effect  TEXT NOT NULL CHECK (effect IN ('debit', 'credit')),
  -- Fixed debit/credit per type; only opening balances and direct entries let the person choose.
  CHECK (
       (type = 'sale'     AND effect = 'debit')
    OR (type = 'purchase' AND effect = 'credit')
    OR (type = 'receipt'  AND effect = 'credit')
    OR (type = 'payment'  AND effect = 'debit')
    OR  type IN ('opening_balance', 'ledger_entry')
  ),
  CHECK (status <> 'draft' OR type IN ('sale', 'purchase')),   -- only invoices and bills have drafts

  txn_date      DATE NOT NULL,
  due_date      DATE,
  CHECK (due_date IS NULL OR due_date >= txn_date),
  reference_no  TEXT,                       -- system number, assigned when posted
  CHECK (status = 'draft' OR reference_no IS NOT NULL),
  external_ref  TEXT,                       -- supplier bill no., cheque no., eSewa id ...
  payment_method TEXT CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'esewa', 'khalti', 'other')),
  CHECK ((type IN ('receipt', 'payment')) = (payment_method IS NOT NULL)),
  description   TEXT,
  notes         TEXT,

  subtotal           NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total     NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  taxable_total      NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (taxable_total >= 0),
  non_taxable_total  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (non_taxable_total >= 0),
  tax_total          NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total              NUMERIC(14, 2) NOT NULL CHECK (total >= 0),
  CHECK (status = 'draft' OR total > 0),    -- posted amounts are always positive; the effect carries the sign

  corrects_transaction_id UUID,
  FOREIGN KEY (business_id, corrects_transaction_id) REFERENCES transactions (business_id, id),

  posted_at   TIMESTAMPTZ,
  posted_by   UUID REFERENCES users (id),
  CHECK (status = 'draft' OR (posted_at IS NOT NULL AND posted_by IS NOT NULL)),
  voided_at   TIMESTAMPTZ,
  voided_by   UUID REFERENCES users (id),
  void_reason TEXT,
  CHECK ((status = 'voided') = (voided_at IS NOT NULL)),
  CHECK (status <> 'voided' OR (voided_by IS NOT NULL AND length(trim(coalesce(void_reason, ''))) > 0)),

  created_by  UUID NOT NULL REFERENCES users (id),
  updated_by  UUID REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (business_id, id),                       -- target for composite foreign keys
  UNIQUE (business_id, type, reference_no)        -- numbers are unique within a business
);

-- A contact has at most one active opening balance.
CREATE UNIQUE INDEX transactions_one_opening_balance_idx
  ON transactions (business_id, contact_id) WHERE type = 'opening_balance' AND status = 'posted';
-- Contact ledger and balances.
CREATE INDEX transactions_ledger_idx
  ON transactions (business_id, contact_id, txn_date, posted_at) WHERE status = 'posted';
-- Lists and reports by type and date.
CREATE INDEX transactions_type_date_idx ON transactions (business_id, type, txn_date);
CREATE INDEX transactions_corrects_idx ON transactions (business_id, corrects_transaction_id) WHERE corrects_transaction_id IS NOT NULL;

CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Posted rows are history. Whatever the application does (or a future bug does), the database refuses to
-- change what was posted or to delete it.
CREATE FUNCTION transactions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Drafts may be deleted. Anything else only disappears if its whole business is being removed.
    IF OLD.status = 'draft' OR NOT EXISTS (SELECT 1 FROM businesses WHERE id = OLD.business_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Posted or voided transactions cannot be deleted; void them instead';
  END IF;

  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'A voided transaction cannot be changed';
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.status NOT IN ('posted', 'voided') THEN
      RAISE EXCEPTION 'A posted transaction can only be voided';
    END IF;
    IF NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.effect IS DISTINCT FROM OLD.effect
       OR NEW.txn_date IS DISTINCT FROM OLD.txn_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
       OR NEW.taxable_total IS DISTINCT FROM OLD.taxable_total
       OR NEW.non_taxable_total IS DISTINCT FROM OLD.non_taxable_total
       OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.corrects_transaction_id IS DISTINCT FROM OLD.corrects_transaction_id
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A posted transaction cannot be changed. Void it and enter a new one';
    END IF;
    -- Still editable: description, notes, external_ref (and the void fields when voiding).
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_guard_trg BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_guard();

-- Down Migration
DROP TABLE transactions;
DROP FUNCTION transactions_guard();
DROP TABLE document_sequences;
