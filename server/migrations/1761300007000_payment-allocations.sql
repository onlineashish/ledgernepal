-- Up Migration
-- Matching a receipt to the sales invoices it pays, or a payment to the purchase bills it settles.
-- Matching NEVER changes a contact's balance: only posted transactions do (docs/accounting-conventions.md).
-- What a receipt or payment does not match is an "advance"; it still counts toward the balance.

CREATE TABLE payment_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Belongs to a business like everything else, and goes with it if the whole business is ever removed.
  business_id     UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  payment_txn_id  UUID NOT NULL,   -- the receipt or payment
  invoice_txn_id  UUID NOT NULL,   -- the sales invoice or purchase bill it is applied to
  FOREIGN KEY (business_id, payment_txn_id) REFERENCES transactions (business_id, id),
  FOREIGN KEY (business_id, invoice_txn_id) REFERENCES transactions (business_id, id),
  CHECK (payment_txn_id <> invoice_txn_id),

  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  created_by   UUID NOT NULL REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_by    UUID REFERENCES users (id),
  voided_at    TIMESTAMPTZ,
  CHECK ((status = 'voided') = (voided_at IS NOT NULL))
);
-- One live allocation per payment/invoice pair (re-allocating voids the old one first).
CREATE UNIQUE INDEX payment_allocations_one_active_idx
  ON payment_allocations (payment_txn_id, invoice_txn_id) WHERE status = 'active';
CREATE INDEX payment_allocations_invoice_idx ON payment_allocations (business_id, invoice_txn_id) WHERE status = 'active';
CREATE INDEX payment_allocations_payment_idx ON payment_allocations (business_id, payment_txn_id) WHERE status = 'active';

-- The rules, enforced by the database whatever the application does:
--   * a receipt applies to a sales invoice, a payment to a purchase bill, for the SAME contact;
--   * both must be posted;
--   * a payment cannot be allocated more than its amount, and an invoice cannot be paid more than its total.
-- The two rows are locked (in a fixed order, so two requests cannot deadlock) before the sums are checked,
-- so two people allocating at the same moment cannot both squeeze through.
CREATE FUNCTION payment_allocations_guard() RETURNS trigger AS $$
DECLARE
  p transactions%ROWTYPE;
  i transactions%ROWTYPE;
  allocated_from_payment NUMERIC;
  allocated_to_invoice NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- An allocation is only ever cancelled, never edited.
    IF NEW.business_id IS DISTINCT FROM OLD.business_id OR NEW.payment_txn_id IS DISTINCT FROM OLD.payment_txn_id
       OR NEW.invoice_txn_id IS DISTINCT FROM OLD.invoice_txn_id OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'An allocation cannot be changed, only cancelled';
    END IF;
    IF OLD.status = 'voided' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'A cancelled allocation cannot be brought back';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM transactions
   WHERE business_id = NEW.business_id AND id IN (NEW.payment_txn_id, NEW.invoice_txn_id)
   ORDER BY id FOR UPDATE;
  SELECT * INTO p FROM transactions WHERE business_id = NEW.business_id AND id = NEW.payment_txn_id;
  SELECT * INTO i FROM transactions WHERE business_id = NEW.business_id AND id = NEW.invoice_txn_id;

  IF p.status <> 'posted' OR i.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted documents can be allocated';
  END IF;
  IF p.contact_id <> i.contact_id THEN
    RAISE EXCEPTION 'A payment can only be applied to documents of the same contact';
  END IF;
  IF NOT ((p.type = 'receipt' AND i.type = 'sale') OR (p.type = 'payment' AND i.type = 'purchase')) THEN
    RAISE EXCEPTION 'A receipt applies to a sales invoice and a payment to a purchase bill';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO allocated_from_payment
    FROM payment_allocations WHERE payment_txn_id = p.id AND status = 'active' AND id <> NEW.id;
  IF allocated_from_payment + NEW.amount > p.total THEN
    RAISE EXCEPTION 'The allocations would be more than the amount received or paid';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO allocated_to_invoice
    FROM payment_allocations WHERE invoice_txn_id = i.id AND status = 'active' AND id <> NEW.id;
  IF allocated_to_invoice + NEW.amount > i.total THEN
    RAISE EXCEPTION 'The allocations would be more than the total of the invoice or bill';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocations_guard_trg BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION payment_allocations_guard();

CREATE FUNCTION payment_allocations_no_delete() RETURNS trigger AS $$
BEGIN
  -- Allocations are history too. They disappear only with the whole business.
  IF EXISTS (SELECT 1 FROM businesses WHERE id = OLD.business_id) THEN
    RAISE EXCEPTION 'Allocations cannot be deleted, only cancelled';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocations_no_delete_trg BEFORE DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION payment_allocations_no_delete();

-- A receipt, payment, invoice or bill that still has live allocations cannot be voided: release them first.
CREATE FUNCTION transactions_void_requires_released_allocations() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'posted' AND NEW.status = 'voided' AND EXISTS (
       SELECT 1 FROM payment_allocations
        WHERE status = 'active' AND (payment_txn_id = OLD.id OR invoice_txn_id = OLD.id)) THEN
    RAISE EXCEPTION 'Cancel the allocations of this document before voiding it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_void_allocations_trg BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_void_requires_released_allocations();

-- Down Migration
DROP TRIGGER transactions_void_allocations_trg ON transactions;
DROP FUNCTION transactions_void_requires_released_allocations();
DROP TABLE payment_allocations;
DROP FUNCTION payment_allocations_guard();
DROP FUNCTION payment_allocations_no_delete();
