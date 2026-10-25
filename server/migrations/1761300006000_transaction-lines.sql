-- Up Migration
-- The lines of a sales invoice or purchase bill. See shared/invoice.js for how they are added up.

CREATE TABLE transaction_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL,
  transaction_id  UUID NOT NULL,
  -- Same-business guarantee, and removing a draft removes its lines.
  FOREIGN KEY (business_id, transaction_id) REFERENCES transactions (business_id, id) ON DELETE CASCADE,

  line_no     INT NOT NULL CHECK (line_no >= 1),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  quantity    NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  unit        TEXT,
  unit_price  NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),

  gross_amount            NUMERIC(14, 2) NOT NULL CHECK (gross_amount >= 0),   -- quantity x unit price
  discount_amount         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  invoice_discount_share  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (invoice_discount_share >= 0),
  CHECK (discount_amount + invoice_discount_share <= gross_amount),

  -- A taxable line carries the VAT rate that applied when it was written (a snapshot: changing the
  -- business's rate later never alters history). 0% is "taxable at zero", different from "not taxable".
  is_taxable  BOOLEAN NOT NULL DEFAULT false,
  tax_rate    NUMERIC(5, 2) CHECK (tax_rate BETWEEN 0 AND 100),
  CHECK (is_taxable = (tax_rate IS NOT NULL)),

  taxable_amount  NUMERIC(14, 2) NOT NULL CHECK (taxable_amount >= 0),
  tax_amount      NUMERIC(14, 2) NOT NULL CHECK (tax_amount >= 0),
  line_total      NUMERIC(14, 2) NOT NULL CHECK (line_total >= 0),
  CHECK (taxable_amount <= gross_amount),
  CHECK (line_total = gross_amount - discount_amount - invoice_discount_share + tax_amount),

  UNIQUE (transaction_id, line_no)
);
CREATE INDEX transaction_lines_tx_idx ON transaction_lines (business_id, transaction_id);

-- Lines are history once the document is posted. Whatever the application does, the database refuses to
-- add, change or remove lines of a posted or voided document. (A draft's lines are free to change; and
-- when the document itself is being deleted, its lines go with it.)
CREATE FUNCTION transaction_lines_guard() RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
  b UUID;
  t UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    b := OLD.business_id; t := OLD.transaction_id;
  ELSE
    b := NEW.business_id; t := NEW.transaction_id;
  END IF;

  SELECT status INTO parent_status FROM transactions WHERE business_id = b AND id = t;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);   -- the parent is already gone (cascade); a missing parent on INSERT fails the foreign key anyway
  END IF;
  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'The lines of a posted or voided document cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transaction_lines_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON transaction_lines
  FOR EACH ROW EXECUTE FUNCTION transaction_lines_guard();

-- Down Migration
DROP TABLE transaction_lines;
DROP FUNCTION transaction_lines_guard();
