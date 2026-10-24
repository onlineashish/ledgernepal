# LedgerNepal — Architecture & Implementation Plan

> Status: **Phase 1 draft — awaiting your review and approval.** No code has been written yet.
> Source of requirements: [requiremend.md](requiremend.md)
> Progress tracking: [progress.md](progress.md)

---

## 1. Application Summary

LedgerNepal is a multi-tenant web application that works as a digital *bahi-khata* (business ledger) for small and medium-sized businesses in Nepal.

- Many independent **businesses** share one deployment. Every business's data is strictly isolated.
- A **user** can belong to several businesses. In each business they have one role (Owner, Business Admin, Accountant, Staff, Viewer). After login, they choose which business is active.
- Each business keeps **contacts** (customers, suppliers, partners). These are plain records; contacts never log in.
- Money movements are recorded as **transactions**: opening balances, direct ledger entries, sales invoices, purchase bills, receipts, and payments. Receipts and payments can be **allocated** to invoices and bills, fully or partially.
- **Balances are never stored.** They are always computed from posted transactions, which gives us one source of truth.
- Posted financial records are **immutable**. Mistakes are fixed by voiding and re-entering, and every step is audit-logged.
- Nepal-specific features: NPR (रु) formatting, BS/AD date entry and display, reports by Nepali fiscal year (Shrawan 1 – Ashadh end), optional VAT with a rate set per business (no hardcoded rate), and PAN/VAT on businesses and contacts.
- A **Platform Administrator** manages business and user account status. They do **not** get access to businesses' financial data.

**Out of scope for the MVP:** inventory, full double-entry accounting (P&L, balance sheet), B2B account linking, tax filing or IRD integration, multi-currency, mobile apps, and paid third-party services.

---

## 2. Technology Choices

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS (or newer LTS) | Required; long-term support |
| Backend | Express 4/5, REST | Required; simple and widely known |
| DB driver | `pg` (node-postgres) with **raw parameterized SQL** in repository modules | Full control over transactions, row locks, and window functions. No ORM magic hiding the `business_id` filter. |
| Migrations | `node-pg-migrate` (SQL migrations) | Versioned, reversible, plain SQL |
| Validation | `zod` | One schema per request body/query; clear error messages |
| Password hashing | `argon2` (Argon2id) | Required |
| Security middleware | `helmet`, `cors` (allow-list), `express-rate-limit`, `cookie-parser` | Standard, free |
| Logging | `pino` + `pino-http` (passwords, tokens, and cookies redacted) | Structured logs with a request ID |
| Money math | Integer **paisa** arithmetic in JS (`BigInt`-safe helpers), `NUMERIC(14,2)` in the DB | No floating point anywhere |
| BS↔AD dates | `nepali-date-converter` (npm), wrapped in our own `lib/dates` module | Well-used library. It will be wrapped and checked against a test table of known dates (leap years, month lengths, year boundaries). If it fails, we replace it behind the same interface. |
| Email | **None for invitations** (decided 2026-10-24): the inviter gets a one-time link to copy and share (e.g. WhatsApp). Password reset needs a delivery channel and is decided in step 3e. Note: Render's free tier blocks outbound SMTP, so if email is added later it must use a provider's HTTPS API (e.g. Brevo, which needs no domain), not `nodemailer` over SMTP. | No domain, no paid service |
| Tests | `vitest` + `supertest`, against a real PostgreSQL test database | Proves real constraints, transactions, and isolation |
| Frontend | React + Vite + JavaScript + React Router | Required |
| Data fetching | `@tanstack/react-query` | Handles caching and loading/error states consistently |
| Forms | `react-hook-form` (+ `zod` resolver) | Same validation library on both sides |
| Styling | Tailwind CSS + a small in-house component set (Button, Input, Table, Modal, Card, Badge, EmptyState…) | Consistent design tokens; responsive; no paid UI kit |
| Printing / PDF | Print stylesheets (browser "Save as PDF") for invoices, receipts, and ledgers in the MVP. Server-side **CSV** export. | Simple and reliable. A server-generated PDF (`pdfkit` + a Devanagari font) can come later. |
| Repo layout | npm workspaces monorepo: `server/`, `client/`, `shared/` | One `npm install`; permission keys and enums shared by both sides |

**Database hosting:** we use **Neon** (managed PostgreSQL). Nothing is installed locally.
- `DATABASE_URL` is the **pooled** endpoint (`-pooler` host). The app uses it at runtime.
- `DATABASE_URL_DIRECT` is the direct endpoint. Migrations use it because they need session-level advisory locks, which PgBouncer's transaction pooling breaks.
- `TEST_DATABASE_URL` points to a **separate Neon branch**, because integration tests wipe data.
- Phase 2 will check that `pg` handles `channel_binding=require`. If it doesn't, we drop that parameter (SSL stays required).

**App hosting:** **Render**, as one Web Service. Express serves the API under `/api` and also the built React files. Running on one origin keeps cookies simple (no cross-site cookies) and means only one service to manage. Render builds automatically from the GitHub `main` branch.

---

## 3. Architecture Diagram

```
┌──────────────────────────── Browser ────────────────────────────┐
│  React SPA (Vite)                                               │
│  React Router · React Query · react-hook-form · Tailwind        │
│  - UI hides what the user can't do (UX only, NOT security)      │
│  - Sends cookie automatically + X-CSRF-Token header             │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTPS  (same-origin in prod; Vite proxy in dev)
                ▼
┌──────────────────────── Express API (/api) ─────────────────────┐
│ helmet → cors(allow-list) → requestId/pino → json(limit)        │
│ → cookieParser → rateLimit (per route group)                    │
│ → authenticate        (session cookie → session row → user)     │
│ → requireCsrf         (all non-GET)                             │
│ → loadBusinessContext (session.active_business_id →             │
│                        ACTIVE membership + ACTIVE business →    │
│                        role + effective permission set)         │
│ → requirePermission('sales.create')                             │
│ → validate(zodSchema)                                           │
│ → controller → service (business rules, db transaction)         │
│              → repository (SQL, ALWAYS WHERE business_id = $1)  │
│ → audit.log(...)  (same db transaction as the change)           │
│ → centralized errorHandler (safe JSON, no stack traces)         │
└───────────────┬─────────────────────────────────────────────────┘
                │ pg Pool (parameterized SQL only)
                ▼
┌──────────────────────── PostgreSQL ─────────────────────────────┐
│ Composite FKs (business_id, id) so cross-tenant links are       │
│ impossible · CHECK constraints · NUMERIC money · UUID PKs ·     │
│ append-only audit_logs · (Phase 5 option: Row-Level Security)   │
└─────────────────────────────────────────────────────────────────┘
```

Each layer has one job:
- **Routes:** wire middleware and permissions.
- **Controllers:** handle HTTP in and out.
- **Services:** business rules and DB transactions.
- **Repositories:** SQL only.

React holds no business logic beyond input convenience and display formatting. Totals are always recalculated on the server.

---

## 4. Proposed Folder Structure

```
Ledger/
├── package.json              # npm workspaces: server, client, shared
├── .env.example              # documented config; real .env is git-ignored
├── .gitignore
├── README.md                 # setup, run, test
├── plan.md / progress.md / requiremend.md
├── docs/
│   ├── accounting-conventions.md   # debit/credit rules, voids, allocations
│   ├── rbac.md                     # permission matrix (source: shared/permissions.js)
│   ├── api.md                      # endpoints + required permission
│   └── operations.md               # deploy, backup, restore (Phase 5)
├── shared/
│   ├── permissions.js        # permission keys + default role matrix
│   ├── enums.js              # transaction types/statuses, payment methods
│   └── money.js              # paisa helpers used by client & server
├── server/
│   ├── package.json
│   ├── migrations/           # node-pg-migrate, numbered SQL files
│   ├── seeds/                # roles/permissions (all envs), demo data (dev only)
│   ├── src/
│   │   ├── server.js         # starts HTTP server
│   │   ├── app.js            # builds Express app (imported by tests)
│   │   ├── config/           # env loading + validation (zod), fail fast
│   │   ├── db/               # pool.js, withTransaction(), test utils
│   │   ├── middleware/       # authenticate, csrf, businessContext,
│   │   │                     # requirePermission, validate, rateLimit, errorHandler
│   │   ├── lib/              # errors, dates (BS/AD, fiscal year), money,
│   │   │                     # sequences, audit, tokens, mailer, csv
│   │   └── modules/
│   │       ├── auth/         # routes.js controller.js service.js repo.js schemas.js
│   │       ├── businesses/
│   │       ├── users/        # members & invitations
│   │       ├── contacts/
│   │       ├── ledger/
│   │       ├── sales/
│   │       ├── purchases/
│   │       ├── receipts/     # receipts & payments share a module internally
│   │       ├── payments/
│   │       ├── allocations/
│   │       ├── reports/
│   │       ├── settings/
│   │       ├── dashboard/
│   │       └── admin/        # platform admin only
│   └── tests/
│       ├── unit/             # money, dates, fiscal year, permission resolution
│       ├── integration/      # API + DB, per module
│       ├── security/         # cross-tenant & RBAC matrix suites
│       └── helpers/          # factories, login helpers, db reset
└── client/
    ├── package.json
    ├── index.html
    ├── vite.config.js        # dev proxy /api → server
    └── src/
        ├── main.jsx
        ├── app/              # router, providers, layouts (Sidebar, AuthLayout)
        ├── api/              # fetch wrapper (CSRF header, error mapping), query keys
        ├── auth/             # AuthContext, ProtectedRoute, RequirePermission
        ├── components/       # design-system components
        ├── features/         # dashboard, contacts, ledger, sales, purchases,
        │                     # receipts-payments, reports, settings, admin
        ├── lib/              # dates (BS/AD display/input), currency format
        ├── i18n/             # string catalog (en now, ne later)
        └── styles/
```

---

## 5. Accounting Conventions (proposed — please confirm)

### 5.1 Debit/credit convention — "the contact's account in our books"

Every posted transaction affects **one contact's account** with either a **Debit** or a **Credit**:

| Effect | Meaning for the business | UI wording |
|---|---|---|
| **Debit (Dr)** | Contact owes us **more** (or we owe them **less**) | "Increases what *{name}* owes you" |
| **Credit (Cr)** | Contact owes us **less** (or we owe them **more**) | "Decreases what *{name}* owes you / you owe them more" |

**Balance = Σ Debits − Σ Credits** (posted transactions only)
- Balance **> 0** → **Receivable**: "*{name}* owes you रु X"
- Balance **< 0** → **Payable**: "You owe *{name}* रु X"

Each transaction type has a fixed effect. The effect is stored on the row and enforced by a CHECK constraint:

| Type | Effect | Example |
|---|---|---|
| `sale` | Debit | Credit sale of goods → customer owes more |
| `purchase` | Credit | Supplier bill → we owe more |
| `receipt` | Credit | Customer pays us → owes less |
| `payment` | Debit | We pay a supplier → we owe less |
| `opening_balance` | Debit **or** Credit (user picks "they owe me" / "I owe them") | |
| `ledger_entry` | Debit **or** Credit (user picks, wording as above) | "Gave goods/cash" vs "Received goods/cash" |

The word "credit" is never shown alone as if it meant "money received". The UI always shows the plain-language meaning next to Dr/Cr.

### 5.2 Transaction lifecycle

- `draft` → `posted` → `voided`. Only sales and purchases may be saved as **drafts**. Drafts are editable, have no ledger effect, and get no final reference number.
- **Posted records are immutable.** Neither the API nor the DB permissions allow UPDATE of amounts or dates on posted rows.
- **Void** (`*.void` / `ledger.correct`): sets `status='voided'`, with a reason, `voided_by`, and `voided_at`. The voided row stays visible in history with no balance effect. Voiding also voids its allocations in the same DB transaction.
- **Correct** = void the original + post a replacement with `corrects_transaction_id` pointing to the original. Both steps happen in one DB transaction.
- Nothing financial is ever hard-deleted. Contacts are **archived**, not deleted. A contact with posted history can't be deleted.

### 5.3 Opening balances

The opening balance is stored as **one `opening_balance` transaction** per contact, not as a column on `contacts`. That way the balance has a single source of truth. The contact form creates or corrects it (void + replace).

### 5.4 Allocations (partial payments, advances)

- A `receipt` can be allocated to one or more posted `sale`s **of the same contact**. A `payment` can be allocated to `purchase`s in the same way.
- Σ allocations of a receipt ≤ receipt total. Σ allocations to an invoice ≤ invoice total. Enforced in the service under `SELECT … FOR UPDATE` row locks, inside one DB transaction.
- Any unallocated remainder is an **advance**. It still reduces the contact's ledger balance, because the ledger uses the receipt total, not the allocations.
- Invoice **paid status** is derived: `unpaid` / `partially_paid` / `paid` = allocated amount vs total.
- Allocations only drive invoice-level status and overdue reports. The contact balance comes purely from the ledger, so the two can never disagree about money owed.

### 5.5 Running balance

Computed in SQL with a window function:
`SUM(CASE effect WHEN 'debit' THEN total ELSE -total END) OVER (ORDER BY txn_date, posted_at, id)`
- Ordering is deterministic.
- When a date filter is applied, the "opening balance as of start date" is the sum of everything before that date.
- Pagination is done in SQL after the window is computed, so page 3 still shows the correct running balance.

### 5.6 Money & VAT

- `NUMERIC(14,2)` in the DB. Integer paisa in JS. Display uses `रु 1,23,456.00` (Nepali/Indian digit grouping).
- Line math (server-side, authoritative):
  `gross = qty × unit_price` → `− line discount` → `taxable_amount` (if line is taxable) → `tax = round(taxable × rate / 100, 2)` → `line_total`.
- Invoice totals: `subtotal`, `discount_total`, `taxable_total`, `non_taxable_total`, `tax_total`, `grand_total`.
- The VAT rate is a **business setting**. It is snapshotted onto each line, so later changes to the setting don't rewrite history. If the business is not VAT-registered, the VAT fields are hidden and the rate is forced to 0.
- Generated documents say "Invoice". We will **not** claim IRD compliance (e.g. "Tax Invoice" format, CBMS sync) until those rules are verified.

### 5.7 Reference numbers

The `document_sequences` table holds one row per (business, document kind, fiscal year). Its counter is incremented with `UPDATE … RETURNING` inside the posting transaction, so numbers are gap-free under concurrency and unique per business.
Default format: `SI-2082/83-0001` (sale), `PB-…` (purchase), `RC-…` (receipt), `PM-…` (payment), `LE-…` (ledger entry), `OB-…` (opening). Prefixes are configurable in settings. A supplier's own bill number is stored separately in `external_ref`.

### 5.8 Dates

- All business dates are stored as PostgreSQL `DATE` in **AD**. BS is never stored in a date column.
- The API accepts and returns ISO AD (`YYYY-MM-DD`) only. BS conversion happens in the client display/input layer and in report or print rendering, using the same `shared` conversion wrapper.
- The **fiscal year** is computed from BS (Shrawan 1 → Ashadh last day) and converted to an AD date range for queries.
- Timestamps (`created_at`, etc.) are `TIMESTAMPTZ`. They are displayed in Asia/Kathmandu (UTC+5:45).

---

## 6. Database Schema

Conventions:
- All primary keys are `UUID DEFAULT gen_random_uuid()`.
- Every business-owned table has `business_id UUID NOT NULL` and `UNIQUE (business_id, id)`, so child tables can use **composite foreign keys** `(business_id, x_id) → parent(business_id, id)`. This makes it **impossible at the database level** to link, say, an invoice in Business A to a contact in Business B.
- All tables have `created_at` and `updated_at TIMESTAMPTZ`.
- Enums are implemented as `TEXT` + `CHECK`, which is easier to migrate than PG enums.

### 6.1 Identity & sessions

```sql
users (
  id UUID PK,
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,              -- argon2id
  full_name TEXT NOT NULL,
  phone TEXT NULL,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (status IN ('active','suspended')) DEFAULT 'active',
  email_verified_at TIMESTAMPTZ NULL,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL,
  password_changed_at TIMESTAMPTZ NULL,
  created_at, updated_at
)

sessions (
  id UUID PK,
  token_hash TEXT NOT NULL UNIQUE,          -- SHA-256 of random 32-byte cookie token
  csrf_token TEXT NOT NULL,                 -- random, returned to SPA
  user_id UUID NOT NULL → users(id) ON DELETE CASCADE,
  active_business_id UUID NULL → businesses(id),
  ip INET NULL, user_agent TEXT NULL,
  created_at, last_seen_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
)  INDEX (user_id) WHERE revoked_at IS NULL

password_reset_tokens (
  id UUID PK, user_id → users, token_hash TEXT UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ NULL, created_at
)
```

### 6.2 Tenancy & RBAC

```sql
businesses (
  id UUID PK,
  name TEXT NOT NULL, legal_name TEXT NULL,
  address TEXT NULL, phone TEXT NULL, email TEXT NULL,
  pan_number TEXT NULL, vat_number TEXT NULL,
  is_vat_registered BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (status IN ('active','suspended')) DEFAULT 'active',
  created_by UUID → users, created_at, updated_at
)

business_settings (                          -- 1:1 with businesses
  business_id UUID PK → businesses,
  date_display TEXT CHECK (date_display IN ('BS','AD')) DEFAULT 'BS',
  default_vat_rate NUMERIC(5,2) NULL CHECK (default_vat_rate BETWEEN 0 AND 100),
  prices_include_vat BOOLEAN NOT NULL DEFAULT false,
  default_credit_days INT NULL CHECK (default_credit_days >= 0),
  sale_prefix TEXT DEFAULT 'SI', purchase_prefix TEXT DEFAULT 'PB', ... ,
  invoice_footer TEXT NULL,
  updated_at, updated_by
)

roles (
  id UUID PK, key TEXT UNIQUE,               -- 'owner','business_admin','accountant','staff','viewer'
  name TEXT, rank INT NOT NULL,              -- owner=100 … viewer=10 (for "can't manage higher roles")
  is_system BOOLEAN DEFAULT true,
  business_id UUID NULL → businesses         -- NULL = system role; non-null reserved for future custom roles
)

permissions (id UUID PK, key TEXT UNIQUE, description TEXT)   -- 'contacts.view', ...

role_permissions (role_id → roles, permission_id → permissions, PRIMARY KEY (role_id, permission_id))

business_users (                             -- membership
  id UUID PK,
  business_id UUID NOT NULL → businesses,
  user_id UUID NOT NULL → users,
  role_id UUID NOT NULL → roles,
  status TEXT CHECK (status IN ('active','deactivated')) DEFAULT 'active',
  invited_by UUID NULL → users, joined_at, deactivated_at, deactivated_by,
  created_at, updated_at,
  UNIQUE (business_id, user_id), UNIQUE (business_id, id)
)  -- partial unique index: exactly one active 'owner' per business (enforced in service + index)

business_user_permission_overrides (         -- per-member grant/deny on top of role
  business_id, business_user_id, permission_id,
  effect TEXT CHECK (effect IN ('grant','deny')),
  granted_by, created_at,
  PRIMARY KEY (business_user_id, permission_id),
  FK (business_id, business_user_id) → business_users(business_id, id)
)

invitations (
  id UUID PK, business_id → businesses, email CITEXT NOT NULL, role_id → roles,
  token_hash TEXT UNIQUE, invited_by → users,
  expires_at, accepted_at NULL, revoked_at NULL, created_at
)
```

**Effective permissions** = role permissions + overrides with `grant` − overrides with `deny`. They are evaluated server-side on every request; there is no per-request DB round-trip beyond one membership query.

### 6.3 Business data

```sql
contacts (
  id UUID PK, business_id UUID NOT NULL → businesses,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_customer BOOLEAN NOT NULL DEFAULT false,
  is_supplier BOOLEAN NOT NULL DEFAULT false,
  is_partner  BOOLEAN NOT NULL DEFAULT false,
  CHECK (is_customer OR is_supplier OR is_partner),   -- "multiple roles" = several true
  phone TEXT NULL, email CITEXT NULL, address TEXT NULL,
  pan_number TEXT NULL, vat_number TEXT NULL, notes TEXT NULL,
  archived_at TIMESTAMPTZ NULL, archived_by UUID NULL,
  created_by, updated_by, created_at, updated_at,
  UNIQUE (business_id, id)
)  INDEX (business_id, name) ; trigram index on name/phone for search (pg_trgm)
   -- NO uniqueness on phone/PAN/VAT (per requirements)

document_sequences (
  business_id → businesses, doc_kind TEXT, fiscal_year TEXT,   -- '2082/83'
  next_value INT NOT NULL DEFAULT 1,
  PRIMARY KEY (business_id, doc_kind, fiscal_year)
)

transactions (
  id UUID PK, business_id UUID NOT NULL → businesses,
  contact_id UUID NOT NULL,
  FOREIGN KEY (business_id, contact_id) → contacts(business_id, id),
  type TEXT NOT NULL CHECK (type IN
       ('opening_balance','ledger_entry','sale','purchase','receipt','payment')),
  status TEXT NOT NULL CHECK (status IN ('draft','posted','voided')),
  effect TEXT NOT NULL CHECK (effect IN ('debit','credit')),
  CHECK ( (type='sale'     AND effect='debit')  OR (type='purchase' AND effect='credit')
       OR (type='receipt'  AND effect='credit') OR (type='payment'  AND effect='debit')
       OR (type IN ('opening_balance','ledger_entry')) ),
  CHECK (status='draft' OR type IN ('sale','purchase')  OR status <> 'draft'),
  txn_date DATE NOT NULL,
  due_date DATE NULL CHECK (due_date IS NULL OR due_date >= txn_date),
  reference_no TEXT NULL,                    -- system number; NULL while draft
  external_ref TEXT NULL,                    -- supplier bill no, cheque no, eSewa txn id
  payment_method TEXT NULL CHECK (payment_method IN
       ('cash','bank_transfer','cheque','esewa','khalti','other')),
  CHECK ((type IN ('receipt','payment')) = (payment_method IS NOT NULL)),
  description TEXT NULL, notes TEXT NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  non_taxable_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  CHECK (status = 'draft' OR total > 0),
  corrects_transaction_id UUID NULL,
  FOREIGN KEY (business_id, corrects_transaction_id) → transactions(business_id, id),
  posted_at TIMESTAMPTZ NULL, posted_by UUID NULL,
  voided_at TIMESTAMPTZ NULL, voided_by UUID NULL, void_reason TEXT NULL,
  CHECK ((status='voided') = (voided_at IS NOT NULL)),
  created_by UUID NOT NULL, updated_by UUID NULL, created_at, updated_at,
  UNIQUE (business_id, id),
  UNIQUE (business_id, type, reference_no)
)
  INDEX (business_id, contact_id, txn_date, posted_at) WHERE status='posted'   -- ledger/balance
  INDEX (business_id, type, txn_date)                                          -- reports/dashboard
  UNIQUE (business_id, contact_id) WHERE type='opening_balance' AND status='posted'

transaction_lines (                          -- only for sale / purchase
  id UUID PK, business_id UUID NOT NULL, transaction_id UUID NOT NULL,
  FOREIGN KEY (business_id, transaction_id) → transactions(business_id, id) ON DELETE CASCADE,
  line_no INT NOT NULL, description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NULL,
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  is_taxable BOOLEAN NOT NULL DEFAULT false,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,  -- snapshot
  taxable_amount NUMERIC(14,2) NOT NULL, tax_amount NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL,
  UNIQUE (transaction_id, line_no)
)
  -- ON DELETE CASCADE is only reachable for drafts (posted rows can't be deleted).

payment_allocations (
  id UUID PK, business_id UUID NOT NULL,
  payment_txn_id UUID NOT NULL,              -- the receipt or payment
  invoice_txn_id UUID NOT NULL,              -- the sale or purchase
  FOREIGN KEY (business_id, payment_txn_id) → transactions(business_id, id),
  FOREIGN KEY (business_id, invoice_txn_id) → transactions(business_id, id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status TEXT CHECK (status IN ('active','voided')) DEFAULT 'active',
  created_by, created_at, voided_by, voided_at,
  UNIQUE (payment_txn_id, invoice_txn_id) WHERE status='active'
)
  -- Service guarantees: same contact; receipt→sale, payment→purchase;
  -- both posted; sums not exceeded (row locks). A constraint trigger
  -- re-checks type pairing + same contact as a DB-level safety net.

audit_logs (                                 -- append-only
  id BIGSERIAL PK,
  business_id UUID NULL,                     -- NULL for platform/auth events
  actor_user_id UUID NULL, actor_ip INET NULL, request_id TEXT,
  action TEXT NOT NULL,                      -- 'transaction.post','member.role_change','auth.login_failed'...
  entity_type TEXT NULL, entity_id UUID NULL,
  before JSONB NULL, after JSONB NULL, metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)  INDEX (business_id, created_at DESC), INDEX (entity_type, entity_id)
   -- app DB role gets INSERT/SELECT only; no UPDATE/DELETE.
```

**Later (justified but not MVP):** `attachments` (local disk storage, served only through an authorized endpoint) and `tax_rates` (if more than one rate is needed).

### 6.4 Relationships at a glance

```
users ─┬─< sessions
       ├─< password_reset_tokens
       └─< business_users >── businesses ──1:1── business_settings
                │                 │
              roles >─< permissions (role_permissions)
                │                 ├─< invitations
     permission_overrides         ├─< contacts ─< transactions ─< transaction_lines
                                  ├─< document_sequences   │
                                  └─< audit_logs           └─< payment_allocations (receipt/payment ↔ sale/purchase)
```

### 6.5 Database roles

- `ledgernepal_owner` runs migrations.
- `ledgernepal_app` is used at runtime. It has no DDL rights and has INSERT/SELECT only on `audit_logs`.

Postgres **Row-Level Security** keyed on `SET LOCAL app.business_id` is planned as optional defense-in-depth in Phase 5. The primary guard is the application layer plus composite FKs.

---

## 7. Role–Permission Matrix (defaults)

Legend: ✅ granted by default · — not granted. The Owner (and Admin, within their limits) can add or remove individual permissions per member through overrides.

| Permission | Owner | Biz Admin | Accountant | Staff | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| `business.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `business.update` (profile, PAN/VAT) | ✅ | ✅ | — | — | — |
| `settings.manage` (tax, numbering, date display) | ✅ | ✅ | — | — | — |
| `users.view` | ✅ | ✅ | — | — | — |
| `users.invite` | ✅ | ✅ | — | — | — |
| `users.manage` (role change, deactivate, overrides) | ✅ | ✅* | — | — | — |
| `contacts.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `contacts.create` | ✅ | ✅ | ✅ | ✅ | — |
| `contacts.update` | ✅ | ✅ | ✅ | ✅ | — |
| `contacts.archive` | ✅ | ✅ | ✅ | — | — |
| `ledger.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ledger.create` (incl. opening balance) | ✅ | ✅ | ✅ | ✅ | — |
| `ledger.correct` (void/correct entries) | ✅ | — | ✅ | — | — |
| `sales.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sales.create` (draft + post) | ✅ | ✅ | ✅ | ✅ | — |
| `sales.update` (edit drafts) | ✅ | ✅ | ✅ | ✅ | — |
| `sales.void` | ✅ | — | ✅ | — | — |
| `purchases.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `purchases.create` | ✅ | ✅ | ✅ | ✅ | — |
| `purchases.update` (edit drafts) | ✅ | ✅ | ✅ | ✅ | — |
| `purchases.void` | ✅ | — | ✅ | — | — |
| `receipts.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `receipts.create` (incl. allocation) | ✅ | ✅ | ✅ | ✅ | — |
| `receipts.void` | ✅ | — | ✅ | — | — |
| `payments.view` | ✅ | ✅ | ✅ | — | ✅ |
| `payments.create` (incl. allocation) | ✅ | ✅ | ✅ | — | — |
| `payments.void` | ✅ | — | ✅ | — | — |
| `reports.view` | ✅ | ✅ | ✅ | — | ✅ |
| `reports.export` (CSV/print) | ✅ | ✅ | ✅ | — | — |
| `audit.view` | ✅ | ✅ | — | — | — |

**Owner-exclusive actions.** These are not grantable permissions; they are hardcoded checks on the `owner` role:
- Transfer ownership
- Change or remove another Owner, Admin, or Owner/Admin role assignment
- Delete or close the business
- Grant `users.manage` to someone

**\* Business Admin limits:**
- Can only invite, change, or deactivate members whose role rank is **below** their own, i.e. Accountant, Staff, or Viewer.
- Can only grant permissions **they themselves hold**.
- Cannot change their own role or permissions.

**Platform Administrator** is a user-level flag, not a business role. It gets **only**:
- `platform.businesses.view` (name, status, created date, member count; **no financial data**)
- `platform.businesses.suspend`
- `platform.users.view`
- `platform.users.suspend`
- `platform.sessions.revoke`

It has **no** business membership and therefore no access to `/api/contacts`, `/api/sales`, etc. If a platform admin also runs their own business, they use a normal membership for it.

**Staff default rationale:** Staff can record day-to-day sales and receipts and add contacts. They cannot void anything, see payments made, or view reports. Please adjust if your intent differs.

---

## 8. Authentication & Multi-Tenant Security Model

### 8.1 Sessions (not JWT)

- **Login** verifies the argon2id hash and checks that `users.status='active'` and the account is not locked. It then creates a `sessions` row and sets the cookie:
  `ln_session=<random 256-bit token>; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=…`
- Only the SHA-256 hash of the token is stored, so a leaked DB dump can't be replayed.
- Idle timeout is 7 days (sliding) and absolute timeout is 30 days. Both are configurable.
- **Server-side sessions** make revocation immediate: logout, password change, user suspension, platform admin action. That's why they were chosen over JWTs.
- **Password change or reset** revokes all of the user's other sessions.

### 8.2 CSRF

The cookie is `SameSite=Lax`. In addition, every non-GET request must send `X-CSRF-Token` matching `sessions.csrf_token` (synchronizer token, returned by `GET /api/auth/me`). The CORS allow-list contains only the app origin, with `credentials: true`.

### 8.3 Active business

- `POST /api/auth/active-business { businessId }` verifies an **active membership** in an **active business**, then stores the business on the session.
- All tenant routes (`/api/contacts`, `/api/sales`, …) take the business **only from the session**. They never use a `business_id` from the URL, body, or query. Any `business_id` field sent by a client is stripped or rejected by validation.
- On **every** request, `loadBusinessContext` re-checks: session valid, user active, membership active, business active. It then resolves effective permissions. So deactivation or suspension takes effect on the very next request, with no logout needed.

> Trade-off: a session has one active business, so two browser tabs share it. If you need different businesses open in different tabs, we'd switch to an `X-Business-Id` header (still membership-checked). The session approach is simpler and safer for the MVP.

### 8.4 Record-level access (IDOR prevention)

- Every repository function takes `businessId` as a required first argument. Every query includes `WHERE business_id = $1 AND id = $2`.
- If a row isn't found in the current business, the API returns **404**, never 403, so it doesn't reveal that the ID exists elsewhere.
- Related IDs in request bodies (`contactId`, `invoiceId`s in allocations) are looked up **within the business** before use. Composite FKs reject them at the DB anyway.
- Exports, prints, and (future) attachments go through the same permission + business checks. No public URLs.

### 8.5 Abuse protection

Rate limits:
- Login: 5 per minute per IP+email, plus progressive account lock after 10 failures.
- Register: limited.
- Password reset request: 3 per hour per email.
- Global API limit.

The password reset response is identical whether or not the email exists. Reset tokens are single-use, last 30 minutes, and are stored hashed.

### 8.6 Errors and logging

Every error uses one format:
`{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [...], "requestId": "..." } }`
- Validation failures return 400.
- Unauthenticated requests return 401.
- Forbidden actions return 403.
- Not found or other-tenant records return 404.
- Conflicts (duplicate, already voided) return 409.
- Rate-limited requests return 429.
- Unexpected errors return 500 with a generic message. Details go only to the server logs.

Logs redact `password`, `token`, `cookie`, and `authorization`.

---

## 9. API Endpoint List

All endpoints are under `/api`. Pagination uses `?page=&pageSize=` (max 100), with sort and filter query params as noted. Responses look like `{ data, meta: { page, pageSize, total } }`.

**Health**

| Method | Path | Auth / Permission |
|---|---|---|
| GET | `/api/health` | public (process up) |
| GET | `/api/health/ready` | public (DB reachable) |

**Auth — `/api/auth`**

| Method | Path | Notes |
|---|---|---|
| POST | `/register` | creates user + first business (+ settings) + Owner membership, in one DB txn |
| POST | `/login` | rate-limited |
| POST | `/logout` | revokes current session |
| GET | `/me` | user, memberships, active business, effective permissions, csrfToken |
| POST | `/active-business` | switch business (membership verified) |
| POST | `/password/forgot` | always 202 |
| POST | `/password/reset` | token + new password; revokes sessions |
| POST | `/password/change` | logged in; requires current password |
| GET / DELETE | `/sessions`, `/sessions/:id` | list / revoke own sessions |

**Businesses — `/api/businesses`**

| Method | Path | Permission |
|---|---|---|
| GET | `/` | memberships of current user |
| POST | `/` | any logged-in user (creates new business, becomes Owner) |
| GET | `/current` | `business.view` |
| PATCH | `/current` | `business.update` |
| POST | `/current/transfer-ownership` | Owner only |

**Users & invitations — `/api/users`** (members of the active business)

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `users.view` |
| GET | `/:membershipId` | `users.view` |
| PATCH | `/:membershipId` (role, overrides) | `users.manage` + rank/grant rules |
| POST | `/:membershipId/deactivate` · `/reactivate` | `users.manage` + rank rules |
| GET | `/invitations` | `users.view` |
| POST | `/invitations` | `users.invite` (role rank < own) |
| DELETE | `/invitations/:id` | `users.invite` |
| GET | `/invitations/accept/:token` (preview) | public, token-bound |
| POST | `/invitations/accept` | logged-in user or new signup with token |

**Contacts — `/api/contacts`**

| Method | Path | Permission |
|---|---|---|
| GET | `/?q=&type=customer\|supplier\|partner&archived=` | `contacts.view` |
| POST | `/` (optional opening balance) | `contacts.create` (+ `ledger.create` if opening balance) |
| GET | `/:id` (incl. current balance) | `contacts.view` |
| PATCH | `/:id` | `contacts.update` |
| POST | `/:id/archive` · `/unarchive` | `contacts.archive` |
| PUT | `/:id/opening-balance` | `ledger.correct` if one already exists, else `ledger.create` |

**Ledger — `/api/ledger`**

| Method | Path | Permission |
|---|---|---|
| GET | `/contacts/:contactId?from=&to=&q=&page=` | `ledger.view` (opening, rows w/ running balance, closing) |
| GET | `/contacts/:contactId/export.csv` | `ledger.view` + `reports.export` |
| GET | `/entries?…` | `ledger.view` (all direct entries) |
| POST | `/entries` | `ledger.create` |
| GET | `/entries/:id` | `ledger.view` |
| POST | `/entries/:id/void` | `ledger.correct` |
| POST | `/entries/:id/correct` | `ledger.correct` (void + replacement, one txn) |

**Sales — `/api/sales`** (Purchases mirror this at `/api/purchases` with `purchases.*`)

| Method | Path | Permission |
|---|---|---|
| GET | `/?from=&to=&contactId=&status=&paymentStatus=` | `sales.view` |
| POST | `/` (draft or `post: true`) | `sales.create` |
| GET | `/:id` (lines, allocations, paid status) | `sales.view` |
| PATCH | `/:id` (draft only) | `sales.update` |
| DELETE | `/:id` (draft only) | `sales.update` |
| POST | `/:id/post` | `sales.create` |
| POST | `/:id/void` | `sales.void` |
| GET | `/:id/print` (print-ready JSON for print view) | `sales.view` |

**Receipts — `/api/receipts`** (Payments mirror this at `/api/payments` with `payments.*`)

| Method | Path | Permission |
|---|---|---|
| GET | `/?from=&to=&contactId=&method=` | `receipts.view` |
| POST | `/` with optional `allocations: [{invoiceId, amount}]` | `receipts.create` |
| GET | `/:id` | `receipts.view` |
| PUT | `/:id/allocations` (re-allocate advance) | `receipts.create` |
| POST | `/:id/void` | `receipts.void` |
| GET | `/contacts/:contactId/open-invoices` | `receipts.create` |

**Dashboard & reports — `/api/reports`**

| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard?from=&to=` | `reports.view`; tiles the user can't see are omitted (e.g. Staff) |
| GET | `/contact-ledger?contactType=customer\|supplier&from=&to=` | `reports.view` |
| GET | `/sales?groupBy=day\|month&from=&to=` | `reports.view` + `sales.view` |
| GET | `/purchases?…` | `reports.view` + `purchases.view` |
| GET | `/receipts-payments?…` | `reports.view` |
| GET | `/receivables?asOf=` | `reports.view` |
| GET | `/payables?asOf=` | `reports.view` |
| GET | `/overdue?asOf=` | `reports.view` |
| GET | `/:report/export.csv` | `reports.export` |

**Settings — `/api/settings`**

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `business.view` |
| PATCH | `/` | `settings.manage` |
| GET | `/audit-log?entityType=&from=&to=` | `audit.view` |

**Platform admin — `/api/admin`** (requires `is_platform_admin`; no tenant data)

| Method | Path |
|---|---|
| GET | `/businesses`, `/businesses/:id` (metadata only) |
| POST | `/businesses/:id/suspend` · `/reactivate` |
| GET | `/users` |
| POST | `/users/:id/suspend` · `/reactivate` (also revokes sessions) |

---

## 10. Prioritized MVP Feature List

**P0: must have before any real use**
1. Registration (user + business), login/logout, `/me`, active-business switching
2. RBAC: roles, permissions, membership checks, backend enforcement, cross-tenant tests
3. Contacts: create/edit/search/filter/archive, opening balance
4. Direct ledger entries: create, void/correct, reference numbers, audit
5. Contact ledger with opening/closing/running balance, date filter, pagination
6. Receipts & payments (all 6 methods) with partial allocation + advances
7. Sales & purchases with lines, discount, optional VAT, draft → post → void
8. Dashboard tiles + quick actions from real data
9. BS/AD date display and input, fiscal-year filter
10. Business settings (profile, PAN/VAT, VAT rate, date preference, numbering)

**P1: needed soon after**
11. Team invitations, role changes, deactivation, per-member permission overrides
12. Reports: receivables, payables, overdue, sales daily/monthly, purchases, receipts/payments, customer/supplier ledgers
13. Print views (invoice, receipt, ledger) and CSV export
14. Password reset via email, session list/revoke
15. Audit log viewer
16. Platform admin: business and user suspend/reactivate

**P2: later**

Attachments, server-generated PDFs with a Devanagari font, Nepali UI language, Postgres RLS, SMS/email reminders, recurring invoices, inventory, B2B linking.

---

## 11. Security Checklist (RBAC & Tenant Isolation)

**Authorization**
- [ ] Every tenant route passes `authenticate → csrf → loadBusinessContext → requirePermission`. A test enumerates the Express router and **fails if any route lacks a permission guard** (unless allow-listed as public).
- [ ] `business_id` always comes from the server-side session context, never from client input.
- [ ] Membership, user, and business status are re-checked on every request.
- [ ] Every repository query is scoped by `business_id`. Code review rule + a lint/grep check in CI.
- [ ] Composite FKs make cross-tenant references impossible in the DB.
- [ ] Not-found and other-tenant records both return 404.
- [ ] Rank rules: no one can manage a member of equal or higher rank (except the Owner). No one can grant a permission they don't hold. No one can change their own role.
- [ ] Owner-exclusive actions are hard-checked. There is always exactly one active Owner.
- [ ] The platform admin flag doesn't grant any tenant route access.
- [ ] Exports and print endpoints are guarded exactly like their source data.

**Authentication & sessions**
- [ ] Argon2id hashing, with a minimum password length of 10 and a breached/common-password blocklist.
- [ ] HttpOnly + Secure + SameSite cookie. Only the token hash is stored. Idle and absolute expiry.
- [ ] CSRF token required on all state-changing requests.
- [ ] Rate limits + account lockout. Generic login error messages.
- [ ] Sessions are revoked on logout, password change/reset, user suspension, and membership deactivation (for that business).

**Data & input**
- [ ] Parameterized SQL only. No string concatenation of user input. Sort columns go through an allow-list.
- [ ] zod validation on every body, query, and param, with unknown keys rejected.
- [ ] Money is validated as positive with a maximum of 2 decimals. Totals are recomputed server-side, and client-sent totals are ignored.
- [ ] React escapes output by default. No `dangerouslySetInnerHTML`. Strict CSP via helmet.
- [ ] CSV export protects against formula injection (`=`, `+`, `-`, `@` prefix escaping).

**Integrity & audit**
- [ ] Posting, voiding, allocation, and numbering happen inside DB transactions with row locks.
- [ ] Posted rows are immutable. Voids require a reason and are audited.
- [ ] Audit log written in the same DB transaction as the change. The app DB role cannot UPDATE or DELETE it.
- [ ] Security events are audited: login success/failure, password reset, role and permission change, deactivation, suspension.

**Operations**
- [ ] Secrets live only in `.env` (git-ignored). `.env.example` has placeholders. Config is validated at startup.
- [ ] No stack traces in responses. Logs are redacted.
- [ ] `npm audit` is run in CI. Dependencies are pinned via the lockfile.
- [ ] Backup/restore is documented and tested (`pg_dump`).

**Required test suites**
- [ ] **Cross-tenant suite:** User A tries to read, update, void, allocate, and export Business B's contacts, transactions, and members. They try this by changing URL IDs, putting B's IDs in bodies (e.g. `contactId`, `invoiceId`), adding `business_id` to body/query, and switching active business to one they aren't a member of. Every attempt is rejected, and the DB is unchanged.
- [ ] **RBAC matrix suite:** auto-generated from `shared/permissions.js`. For each role × each endpoint, assert allowed (2xx) or denied (403).

---

## 12. Phased Implementation Plan

Each step ends with:
- what changed
- files touched
- commands to run
- tests passing (real output, not claimed)

### Phase 1 — Requirements & architecture *(this document)*
- [x] Summary, architecture, schema, RBAC matrix, API list, MVP list, security checklist, phases
- [ ] **Your review + answers to the open questions in §13**

### Phase 2 — Project foundation
1. Prerequisites in WSL: Node LTS via `nvm`, git. Database = Neon (main branch for dev, a separate `test` branch for tests).
2. `git init`, `.gitignore` *(done)*, `.env` / `.env.example` *(done)*, npm workspaces (`server`, `client`, `shared`), GitHub repo + first push
3. Express app skeleton: config validation, pino, helmet, cors, error handler, `/api/health` + `/api/health/ready`
4. `pg` pool + `withTransaction` helper
5. `node-pg-migrate` setup + first migrations (extensions `pgcrypto`, `citext`, `pg_trgm`; users, sessions, businesses, settings, roles, permissions, memberships, audit_logs)
6. Seed: roles + permissions + role_permissions from `shared/permissions.js`
7. Vitest + supertest + test DB reset helper. First tests: health, config, migration up/down
8. Vite + React + Router + Tailwind + React Query skeleton, app shell (navy sidebar, header), dev proxy
9. `shared/money.js` + `lib/dates` with **unit tests** (paisa math, NPR formatting, BS↔AD reference table, fiscal year boundaries)

### Phase 3 — Authentication & authorization
1. Register (user + business + owner membership), login, logout, `/me`, CSRF, rate limits
2. Session revocation, suspension checks, active-business switching, business picker page
3. `loadBusinessContext` + `requirePermission` + route-guard coverage test
4. Members, invitations, role changes, overrides, rank rules, owner transfer
5. Frontend: auth pages, `ProtectedRoute`, `RequirePermission`, business switcher
6. Contacts minimal CRUD (needed as test subject) → **cross-tenant and RBAC suites written and passing before any money feature**
7. Password reset (delivery channel to be decided in 3e: no domain, so no email-from-own-domain; see progress.md)

### Phase 4 — Core business features
1. Contacts (full): search, filters, archive, details page, opening balance
2. Direct ledger entries: sequences, create, void/correct, contact ledger with running balance + pagination
3. Sales & purchases: lines, VAT math, drafts, post, void
4. Receipts & payments: methods, allocations, advances, open-invoice picker
5. Paid status, overdue logic, consistency tests (ledger balance vs allocations)
6. Dashboard + reports
7. Print views + CSV export
8. Settings UI (business profile, PAN/VAT, VAT rate, date display, numbering) + BS/AD input everywhere

### Phase 5 — Hardening
1. Authorization gap review (route audit, query audit), optional Postgres RLS
2. Financial consistency tests (randomized posting/voiding sequences → balances reconcile)
3. Edge cases: concurrency on sequences/allocations, BS boundary dates, large amounts, rounding
4. Responsive/mobile polish, accessibility pass, empty/error states
5. Docs: README install, Render deployment (`render.yaml`, env vars, health check `/api/health/ready`), Neon backups (point-in-time restore / branches) + a `pg_dump` export drill

---

## 13. Open Questions — RESOLVED (2026-10-24)

You accepted **all proposed defaults** below. Q12 was answered: hosting on **Render**, with the database on **Neon**.

1. **Overdue definition.** Is an invoice overdue when `due_date < today` and it is unpaid?
   *Default:* each sale/purchase gets a `due_date`, which defaults to `txn_date + business default_credit_days`. If neither is set, the invoice is never overdue.
2. **Net vs separate balances.** For a contact who is both customer and supplier, is there **one net balance**?
   *Default:* yes, one net balance (bahi-khata style). Receivables report = contacts with a net positive balance; payables = net negative.
3. **Cash sales.** Should "Create Sale" have a "paid in full now" option that creates a sale + receipt + allocation in one step?
   *Default:* yes. A walk-in sale still needs a contact; we'll seed a default "Cash Customer" contact per business.
4. **Discounts.** Per-line only, or also an invoice-level discount?
   *Default:* both. An invoice-level discount is spread proportionally across lines before VAT.
5. **VAT pricing.** Are unit prices entered **excluding** VAT?
   *Default:* yes, with a business setting `prices_include_vat` for later. The default rate is empty until the owner sets it (no hardcoded 13%).
6. **Numbering.** Should numbers reset each fiscal year (`SI-2082/83-0001`)?
   *Default:* yes.
7. **Allocation of advances.** When a receipt is recorded without choosing invoices, should it stay as an unallocated advance, or auto-apply oldest-first (FIFO)?
   *Default:* stays unallocated, with a one-click "auto-apply oldest first" button.
8. **Staff permissions.** Is the Staff column in §7 (create sales/receipts/contacts/ledger entries, no voids, no payments-out, no reports) what you want?
9. **Business Admin voids.** Should Business Admins be able to void financial records by default?
   *Default:* no. That right is with Owner + Accountant, and the Owner can grant it per member.
10. **Multiple owners.** One owner per business with ownership transfer, or co-owners allowed?
    *Default:* exactly one owner.
11. **Editing posted records.** Is "void + re-enter" acceptable for every correction, including typo fixes in description/notes?
    *Default:* description and notes stay editable on posted rows (audited); amounts, dates, contact, and type are not.
12. **Hosting target.** Where will you deploy eventually (own Linux VPS, local office machine, …)? This only affects the Phase 5 docs.
