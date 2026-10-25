# Accounting conventions

The rules every money feature follows. If code and this document disagree, one of them is a bug.

## 1. One account per contact

Every contact has one running account in the business's books, like a page in a *khata*. Every posted
transaction adds one line to that page. There is **one net balance per contact**, even if the contact is
both a customer and a supplier.

## 2. Debit and credit mean "owes me more / owes me less"

In this app the words are used in one fixed way, always from the point of view of **what the contact owes the business**.
They do **not** mean "money in" or "money out".

| Entry | Effect on the contact's account | Plain words |
|---|---|---|
| **Debit (Dr)** | balance goes **up** | the contact owes you **more** (or you owe them less) |
| **Credit (Cr)** | balance goes **down** | the contact owes you **less** (or you owe them more) |

**Balance = total debits − total credits** (posted transactions only).

| Balance | Meaning | Shown as |
|---|---|---|
| greater than 0 | **Receivable**: the contact owes you | "Ram owes you रु 5,000.00" |
| less than 0 | **Payable**: you owe the contact | "You owe Ram रु 5,000.00" |
| 0 | Settled | "Settled" |

## 3. Which transaction types are debits and which are credits

| Type | Effect | Example |
|---|---|---|
| `sale` | Debit | You sell on credit: the customer owes more |
| `purchase` | Credit | A supplier bills you: you owe more |
| `receipt` | Credit | A customer pays you: they owe less |
| `payment` | Debit | You pay a supplier: you owe less |
| `opening_balance` | Debit or Credit (you choose) | "Ram owed me रु 5,000 when I started using the app" |
| `ledger_entry` | Debit or Credit (you choose) | A direct entry with no invoice |

The database enforces this table: a sale cannot be saved as a credit.

### Direct ledger entries: *You gave* / *You got*

Direct entries are the only place where the person picks the direction, so the screen avoids the words
debit and credit and uses the khata words instead:

| You choose | Stored as | Meaning | The balance… |
|---|---|---|---|
| **You gave** (दिएको) | Debit | You gave goods, money or services; they owe you more | goes up |
| **You got** (पाएको) | Credit | You received goods, money or services; they owe you less | goes down |

The screen always spells out the result: *"You gave रु 2,000 → Ram will owe you रु 7,000"*.

## 4. Opening balances

An opening balance is **one ordinary transaction** (type `opening_balance`), not a column on the contact.
That keeps a single source of truth for the balance. A contact has at most one active opening balance.
It is dated ("as of"), appears first in the contact's ledger on that date, and is changed like any other
posted entry: void and replace.

| You choose | Stored as |
|---|---|
| They owe me (receivable) | Debit |
| I owe them (payable) | Credit |

## 5. Posted entries are never edited or deleted

| Status | Meaning |
|---|---|
| `draft` | Saved but not yet counted (sales and purchases only). Editable and deletable. |
| `posted` | Counts toward balances. **Amount, date, contact, type and direction can never change.** |
| `voided` | Cancelled. Kept for history with who, when and why. Counts for nothing. Frozen. |

The database itself refuses to update the financial fields of a posted row or to delete it.

- **Void** needs a written reason and the `*.void` / `ledger.correct` permission.
- **Correct** is a void plus a replacement saved together, so there is never a moment with both or neither.
  The replacement points back to the original (`corrects_transaction_id`).
- Still editable on a posted entry (and audited): description, notes, external reference.
- A mistake in the contact, type or direction is fixed by voiding and entering again.

## 6. Running balance and ordering

A contact's ledger lists posted transactions in this order: **date, then opening balance first, then the time
it was posted, then id** (so the order is always the same). The running balance after each line is the sum of
every posted line up to and including it. Filtering by date or search text never changes a line's running
balance; the *opening* shown for a date range is the balance just before the range starts.

Balances are **calculated from the posted transactions every time**. They are not stored anywhere else, so
two numbers can never disagree.

## 7. Reference numbers

Every posted transaction gets a number that is unique within the business, per kind and fiscal year:
`LE-2082/83-0001` (direct entry), `OB-…` (opening balance), later `SI-…` sale, `PB-…` purchase,
`RC-…` receipt, `PM-…` payment. The prefix comes from the business settings; the fiscal year is the one
containing the transaction date. Numbers are handed out inside the same database transaction as the entry,
so they are gap-free and never repeated, even with several people saving at once.
A person-supplied reference (cheque number, bill number, eSewa id) is stored separately as the *external reference*.

## 8. Money

Amounts are in NPR with two decimals. They travel as text (`"1250.50"`), are held as whole paisa in code
and stored as `NUMERIC(14,2)`; floating-point numbers are never used. Rounding is half-up, once per computed value.
An amount must be greater than zero; direction carries the sign.

## 9. Dates

Every transaction date is a plain calendar date stored in AD. BS is converted only for typing and display.
See `shared/dates.js`. The fiscal year starts on Shrawan 1.

## 10. Sales invoices and purchase bills

A sale is a debit (the customer owes you more); a purchase is a credit (you owe the supplier more).
Both use the same rules, in `shared/invoice.js` (the server stores the result; the screens only preview it).

### How a document is added up

For each line:

| Step | Rule |
|---|---|
| Gross | quantity × unit price (rounded once to the paisa, half up) |
| After line discount | gross − the line's own discount (a discount can never exceed the line) |
| Invoice discount share | the invoice-level discount is spread over the lines **in proportion to their amount after line discounts**, so the shares add up to the discount exactly |
| Net | after line discount − share |
| Taxable amount | the net amount if the line has a VAT rate, otherwise 0 |
| VAT | taxable amount × rate, rounded once per line |
| Line total | net + VAT |

For the document: subtotal = Σ gross; discount = line discounts + invoice discount; taxable total, non-taxable total and
VAT total are the sums of the lines; **total = taxable + non-taxable + VAT = subtotal − discount + VAT**.
The invoice discount is spread *before* VAT, so VAT is charged on the reduced price.

### VAT

- Nothing is assumed. A business is **not** VAT-registered unless it says so in Settings, and then no line may carry VAT.
- Each taxable line uses its own rate, or the business's default rate; if neither exists the line is refused.
- A rate of 0% means "taxable at zero", which is different from "not taxable".
- The rate is copied onto the line when it is written. Changing the business's rate later never changes a saved document.
- Taxable amount, VAT and total are always shown separately. This is basic VAT bookkeeping, **not** a statement that the printed
  document meets Nepal's invoice rules; check those before relying on it.

### Life of a document

- A **draft** has no number and no effect on any balance. It can be edited (send the lines again to change amounts) and deleted.
- **Posting** gives it its number (`SI-2082/83-0001` for sales, `PB-…` for purchases; the fiscal year is the one containing the
  *document date*) and it starts counting toward the contact's balance. Posting needs at least one line and a total above zero.
- A **posted** document can no longer be changed except for its notes and its reference (supplier's bill number, customer's PO number).
  Its lines are protected by the database too. To change anything else: **void** it (reason required) and enter a new one.
- A **voided** document stays on record, stops counting, and is frozen.
- Only drafts are deleted. Voiding a draft is not possible: delete it.

### Due dates

A document's due date is the one you give; if you give none, it is the document date plus the business's default credit days;
if the business has set no credit days, there is no due date and the document is never overdue.

## 11. Receipts, payments and allocation

- A **receipt** (money in) is a credit; a **payment** (money out) is a debit. Both are posted immediately, numbered `RC-`/`PM-`, and immutable except description, notes and reference; they can be voided.
- A receipt may be **applied** to sales invoices, a payment to purchase bills, of the same contact, posted only. The total applied never exceeds the receipt/payment amount, and the total applied to a document never exceeds its total. The database enforces this, including for simultaneous requests.
- The part not applied is an **advance**. It still counts toward the contact's balance. Applying or re-applying never changes any balance: only posted transactions do.
- A document is **unpaid**, **partially paid** or **paid** from its live allocations. It is **overdue** when it has a due date in the past and still owes something (drafts and voided documents never are).
- Voiding a receipt/payment releases its allocations. Voiding an invoice/bill releases the payments applied to it, which become advances. The database refuses to void a document that still has live allocations.

## 12. Dashboard and reports

- Every figure is derived from POSTED transactions; drafts and voided documents are never counted. Sales, purchases, receipts and payments are totalled by transaction date inside the period (default: the current fiscal year, Shrawan 1 to the end of Ashadh). Monthly rows use Bikram Sambat months when the business shows BS dates.
- "Owed to you" and "you owe" are today's contact balances (positive / negative), whatever the period. A customer who paid in advance therefore appears under "you owe". Overdue is the amount still outstanding on documents past their due date.
- Balances are financial data: they need the ledger permission as well as the reports permission.
- Exports (CSV) need the export permission and are recorded in the audit log.
