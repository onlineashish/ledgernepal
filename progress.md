# LedgerNepal — Progress Log

> Plan: [plan.md](plan.md) · Requirements: [requiremend.md](requiremend.md)
> Rule: a step is only ticked when it is implemented **and** its tests pass (with real output recorded).

## Current status

| Phase | Status |
|---|---|
| 1. Requirements & architecture | ✅ Approved — all defaults accepted (plan.md §13) |
| 2. Project foundation | ✅ Done (2a–2d). 184 automated tests passing (shared 119, server 51, client 14). Branch `phase2-foundation`, ready to merge. |
| 3. Authentication & authorization | ✅ Done (3a–3e). 646 automated tests passing (shared 119, server 422, client 105). Branch `phase3-auth`, ready to merge. |
| 4. Core business features | 🟡 In progress — 4a–4e done on branch `phase4-ledger` (ledger engine, contact & ledger screens, sales & purchases engine, sales & purchases screens + Settings, receipts & payments server); 4f receipts & payments screens next |
| 5. Hardening | ⚪ Not started |

Legend: ⚪ not started · 🟡 in progress / awaiting input · ✅ done (tests passing)

---

## Phase 1 — Requirements & architecture

- [x] Read requirements ([requiremend.md](requiremend.md))
- [x] Application summary — plan.md §1
- [x] Technology choices — plan.md §2
- [x] Architecture diagram — plan.md §3
- [x] Folder structure — plan.md §4
- [x] Accounting conventions (Dr/Cr, voids, allocations, running balance, VAT, numbering, dates) — plan.md §5
- [x] Database schema & relationships — plan.md §6
- [x] Role–permission matrix — plan.md §7
- [x] Auth & multi-tenant security model — plan.md §8
- [x] API endpoint list — plan.md §9
- [x] Prioritized MVP list — plan.md §10
- [x] Security checklist — plan.md §11
- [x] Phased implementation plan — plan.md §12
- [x] Owner review & approval of architecture (2026-10-24)
- [x] Answers to open questions: all defaults accepted; DB = Neon, hosting = Render

**Files created:** `plan.md`, `progress.md`
**Code written:** none (as instructed by requirements §18)

## Phase 2 — Project foundation

- [x] `.env` (Neon URLs, git-ignored), `.env.example`, `.gitignore`
- [x] WSL prerequisites (Node 22.23.3 via nvm, git); Neon `test` branch in `TEST_DATABASE_URL`
- [x] git init, GitHub repo (`onlineashish/ledgernepal`) + first push; npm workspaces (`server`)
- [x] Express 5 skeleton, zod config validation (fail-fast, test DB guard), pino logging with redaction, helmet, CORS allow-list, centralized error handler
- [x] Health endpoints: `/api/health`, `/api/health/ready`
- [x] pg pool + `withTransaction` helper; `npm run db:check` (all 3 Neon URLs connect, `sslmode=verify-full`)
- **Step 2a tests:** 18/18 passing (`npm test`, 2026-10-24) — config (7), error handler (3), health/errors/CORS integration (8)
- [x] Migrations (4 files in `server/migrations/`): extensions + `set_updated_at`; users, businesses, business_settings, sessions, password_reset_tokens; roles, permissions, role_permissions, business_users (+ one-active-owner index, `is_owner` trigger), permission overrides (composite FK), invitations; audit_logs (append-only triggers). Applied to the main and test Neon databases; full rollback + re-apply verified on the test branch.
- [x] Role/permission seed from `shared/permissions.js` (idempotent; `npm run db:seed`; also runs inside `db:migrate` and test setup)
- **Step 2b tests:** 44/44 passing (2026-10-24) — adds 26 DB tests: seeded matrix per role, case-insensitive unique email, CHECK constraints, one active owner, cross-business override FK rejection, single open invitation, session cascades, audit_logs update/delete/truncate blocked
- Commands: `npm run db:migrate` · `db:migrate:down` (1 step) · `db:seed` · `db:status`
- Not done on purpose: separate low-privilege DB role for the app (audit immutability is enforced by triggers instead; revisit in Phase 5 with RLS)
- [ ] Test harness (vitest + supertest + test DB)
- [x] React 19 + Vite 8 + React Router 8 + Tailwind 4 + React Query shell (`client/`): navy sidebar, 8 nav sections, Ledger → View Ledger / Add Ledger Entry, mobile drawer, dashboard with 6 quick actions and a live server-status card, honest "Coming soon" placeholders for unbuilt pages, 404 page, `apiFetch` wrapper (error envelope → `ApiError`, CSRF header ready), string catalog for future Nepali (`src/i18n`)
- [x] Express serves `client/dist` with SPA fallback in production (API paths still return JSON 404); `npm run dev` runs API + Vite with `/api` proxy; `npm run build` builds the client
- **Step 2c tests:** server 51/51 + client 14/14 passing (2026-10-24). Verified by running: production build served on one port (`/`, `/contacts` refresh, `/api/health/ready`, JSON 404 under `/api`), and dev proxy through Vite. **Not yet checked by eye in a browser** — open http://localhost:5173 after `npm run dev` and confirm the look.
- [x] `shared/money.js`: money as BigInt paisa; strict parse (≤2 decimals, rejects commas/exponents/float noise); `NUMERIC(14,2)` limit; Nepali digit grouping (`रु 1,23,456.78`); half-up rounding applied once per value; quantity × price, percent-of, exact proportional allocation (largest remainder), `calculateLine` (gross → discount → taxable → tax → total; no tax when no rate)
- [x] `shared/dates.js`: AD ISO is canonical; BS conversion via `@remotemerge/nepali-date-converter` (BS 1975–2099 / AD 1918-04-13 – 2043-04-13) wrapped with our own validation; BS input/format; `todayInNepal` (UTC+05:45); BS month ranges; fiscal year (Shrawan 1 – Ashadh end) and `fiscalYearOf`
- **Step 2d tests:** shared 119/119, identical results under TZ=UTC, Asia/Kathmandu, America/Los_Angeles, Pacific/Kiritimati. Date tests: 8 published New Year anchors (both directions); BS year lengths cross-checked against real gaps between New Year dates; every one of the ~45,600 supported days round-trips and advances exactly one BS day; all 1,500 BS months are 29–32 days; invalid/leap/out-of-range dates; fiscal years contiguous 2070–2095 and 365/366 days each.
- [x] `.github/workflows/ci.yml`: runs all tests + client build on PRs and pushes to `main`; serialised so only one run uses the test DB. **Needs repository secret `TEST_DATABASE_URL`.**
- [x] `render.yaml` (build `npm ci --include=dev && npm run build && npm run db:migrate`, start `npm start`, health check `/api/health/ready`). **Not yet deployed or verified** — the first Render deploy is the real test.
- [x] `README.md` with setup and commands

### Phase 2 summary
Done: Express API foundation, validated config, error handling, logging, health checks; Neon connection and versioned migrations (users, sessions, businesses, RBAC, memberships, audit log); seeded permission matrix; React shell; money and BS/AD date libraries; CI and Render config.
Known gaps / things to verify later: UI not yet reviewed by eye in a browser; CI and Render not yet run for real; DB password was pasted in chat once (rotate it); app still connects as the Neon owner role (Phase 5).

## Phase 3 — Authentication & authorization

- [x] **3a** Register / login / logout / `me` / CSRF / rate limits / lockout / audit (`/api/auth/*`, `server/src/modules/auth`):
  - Argon2id hashing (19 MiB, 2 passes), password rules (10–128 chars, common-password list, not equal to email/name), timing-equalised unknown-email check
  - Server-side sessions: random cookie token (only its SHA-256 stored), HttpOnly + SameSite=Lax + `Path=/api` (+ Secure in production), 7-day idle / 30-day absolute expiry, revoked on logout and on suspension
  - CSRF: per-session token in `X-CSRF-Token` on every state-changing request, plus Origin check and JSON-only bodies
  - Rate limits (in memory): 5 failed logins/min per IP+email, 30/15 min per IP, 10 registrations/hour, 300 API calls/min; account lock after 10 failures for 15 min (generic error, never reveals the lock)
  - Registration creates user + business + settings + Owner membership + session in one transaction; unknown body fields (e.g. `isPlatformAdmin`, `role`) are rejected
  - Active business lives on the session; switching verifies an active membership in an active business, and "not found / not a member / suspended" all return the same 404
  - `loadBusinessContext` computes effective permissions (role + grants − denies; Owner always all) in one query per request
  - Audit events: register, business.create, login, login_failed, login_blocked, account_locked, logout, switch_business
  - **Tests (3a):** server 112/112 (44 auth integration + unit tests for passwords, tokens, permission resolution); whole repo 245/245 (2026-10-24). A test caught a real bug (lockout never triggered because of a config/SQL name mismatch) — fixed.
- [x] **3b** Permission enforcement, contacts API, and the security suites:
  - `requirePermission(...)` (409 `NO_ACTIVE_BUSINESS` / 403 `FORBIDDEN`); unknown permission names throw at startup. `guards.session` (account routes) and `guards.tenant('perm')` (business data) are the only ways to protect a route (`server/src/middleware/guards.js`). Business and user come from the session, never from the request.
  - Migration `…004_contacts.sql`: `contacts` table (≥1 role, no uniqueness on phone/PAN/VAT, `UNIQUE (business_id, id)` for future composite FKs, trigram index)
  - Contacts API `/api/contacts`: list (search name/phone/email/PAN/VAT with literal `%`/`_`, type filter, archived filter, pagination with totals), create, get, update (partial, clears with null/""), archive, unarchive; strict validation (unknown fields incl. `business_id` → 400); audit entries with before/after diff. Balances/opening balance arrive with the ledger in Phase 4.
  - **Route-guard coverage test** (`tests/security/routeGuards.test.js`): lists every mounted route; fails if any route outside the explicit public/account allow-lists lacks authenticate → business → csrf → permission, if a permission name is unknown, or if a router was mounted without the registry. Mutation-checked: removing one guard makes it fail and names the route.
  - **Cross-tenant suite** (`tests/security/tenantIsolation.test.js`, 28 tests): A cannot read/modify/archive/unarchive B's contacts by id (404 identical to a nonexistent id), cannot see them in list/search/filters, cannot redirect via `business_id`/`businessId` in body or query (400), ignores business headers, cannot switch into B, cannot borrow B's CSRF token; SQL-looking ids/search text are inert; staff-in-A/viewer-in-B never gets the union of powers; deactivated member, suspended business and changed role take effect on the next request; platform admin gets no tenant access. Mutation-checked: removing the business filter from the contact lookup makes 6 of these fail.
  - **RBAC matrix** (`tests/security/rbacMatrix.test.js`): 5 roles × 6 endpoints generated from `shared/permissions.js`; denied calls are 403 and change nothing; overrides (grant, deny, owner immune, live without re-login); `/me` permissions equal what the server enforces.
  - **Tests (3b):** server 237/237, whole repo 370/370 (119 shared + 237 server + 14 client), 2026-10-24.
  - Honest limits: RBAC/isolation is proven for the contacts module only; every future module must add its endpoints to the matrix and isolation tests (the coverage test forces guards, not tests). Tests run against the real Neon database, so the full suite takes ~2–3 minutes.
- [x] **3c** Members, invitations (link only, no email), role changes, overrides, rank rules, ownership transfer
  - **Decision:** no email for invitations (no domain). The inviter receives a one-time link (`<APP_ORIGIN>/accept-invite?token=…`) to copy and share, e.g. on WhatsApp. Only a SHA-256 hash of the token is stored, so the link cannot be shown again; if lost, revoke and re-invite. Links last 7 days. The token travels in POST bodies, never in URLs (keeps it out of access logs).
  - Rules (`server/src/lib/memberRules.js`, pure + unit-tested): roles can only be assigned below your own rank; you can only manage members ranked below you; never yourself, never the owner; "owner" is not an assignable role (only transfer-ownership); overrides can only newly grant permissions the giver holds, `users.manage` only by the owner; lifting a deny counts as granting; a role change wipes the member's old overrides unless new ones are sent in the same request; denies are always allowed.
  - API: `GET /api/users`, `GET /api/users/:membershipId`, `PATCH /api/users/:membershipId` (roleKey and/or complete overrides list), `POST …/deactivate`, `POST …/reactivate`, `GET/POST /api/users/invitations`, `DELETE /api/users/invitations/:id`; public `POST /api/invitations/preview` and `POST /api/invitations/accept-new`; logged-in `POST /api/invitations/accept` (account email must match the invitation; a removed member who returns gets the invited role, no old overrides); owner-only `POST /api/businesses/current/transfer-ownership` (password re-entry, wrong password counts toward lockout, row-locked swap so exactly one active owner always exists).
  - New guard `guards.owner` for owner-exclusive actions; route-coverage test extended (public, account and owner lists); invitation endpoints rate-limited (20/15 min per IP).
  - **Tests (3c):** unit 24 (member rules); integration 33 (members, overrides, deactivation, cross-business, ownership) + 29 (invitations); RBAC matrix extended to all 8 new endpoints × 5 roles; whole repo **499/499** (119 shared + 366 server + 14 client), 2026-10-24. Mutation-checked: weakening the rank rule fails 4 tests across unit and integration.
  - Known limits: an invitation link is a bearer secret — anyone holding it AND an account with the matching email (or who signs up through it) can join, so share it only with the invitee. Emails are not verified, so "matching email" is a sanity check, not proof of identity.
- [x] **3d** Frontend auth flow (`client/src/auth`, `client/src/features/team`)
  - `AuthProvider` mirrors the server session (`/auth/me`), holds the CSRF token, and exposes `can()/canAny()`; every user or business change removes all cached business data (only the "me" query is kept); a 401 from any protected call logs the person out locally.
  - Pages: Log in, Create your business account, Choose a business (after login with several memberships), Accept invitation (works logged out as a new person, logged out with an existing account → log in and come back to the link, logged in with the right or wrong email), Team (members table with role change and two-step deactivate/reactivate, invite form, pending invitations with revoke).
  - Invitation links: shown once with **Copy link** and **Share on WhatsApp**; no email involved. The token is sent only in POST bodies.
  - Route protection: `RequireAuth` (login, then business), `PublicOnly`, `RequirePermission` ("no access" page and no data request when a role lacks access). Sidebar items, ledger sub-items and dashboard quick actions are filtered by permission — a convenience only; the server enforces everything.
  - Sidebar footer: business name or switcher (when in several businesses), person and role, Log out.
  - **Server change:** request logs now contain only the URL path — no query string, no parsed query object, no Referer — so invitation tokens (`/accept-invite?token=…`) and search text cannot reach the logs. A test caught that the first attempt did not work (the HTTP logger has its own serializer).
  - **Bugs found by the tests and fixed:** (1) clearing the whole query cache on login also removed the session query the app was watching, so a successful login never left the login page; (2) after choosing a business the app navigated before the new session reached the screen and was redirected back to the picker; (3) a failed logout request threw an unhandled error.
  - **Tests (3d):** client 66/66 (was 14): login, register, protected routes, logout, session expiry, business switching and cache clearing, permission-based navigation, invitation page flows, team page. Server +3 (log safety). Whole repo **554/554** (119 shared + 369 server + 66 client), 2026-10-25.
  - **Not done in 3d (API exists, UI later):** per-member permission overrides editor and the transfer-ownership screen (planned with Settings in Phase 4). **Not checked by eye in a browser yet** — run `npm run dev` and try register → invite → accept in a second browser profile.
- [x] **3e** Password reset (email AND owner-assisted), change password, session list
  - **Decision (2026-10-25):** both reset paths. Email goes through Brevo's HTTPS API (Render's free tier blocks SMTP; Brevo needs no domain), so no `nodemailer`. Providers: `brevo` (production), `console` (development; prints the link), `memory` (tests; forced in tests so a test run can never send real mail), `none` (production default). The console provider is refused in production because it would put reset links in shared logs. Email is optional: without it only the owner-assisted path exists.
  - **Forgot password** `POST /api/auth/password/forgot`: always the same instant 202; the lookup and mailing happen after the response (background task), so neither the answer nor its timing reveals whether an account exists. Mail failures or a missing provider are logged, never shown. Token: 256 random bits, only the hash stored, 30 minutes, single use, a newer request cancels older links; limits 3/hour per address+email and 20/hour per address (applies to unknown emails too).
  - **Reset** `POST /api/auth/password/reset`: one message for unknown/expired/used links; same password rules; a rejected password does not burn the link; on success the password changes, **every session of that person ends**, any lock is cleared, all other links die, a "your password was changed" notice is emailed.
  - **Owner-assisted** `POST /api/users/:membershipId/password-reset-link` (needs `users.manage`): one-time link (24 h, shown once, copy/WhatsApp) that the PERSON opens to choose their own password. Rules: normal rank rules; target must be active; **refused if the person belongs to any other business (active or not)**, because holding the link could otherwise unlock that business; refused for platform admins and other businesses' members (404). Audited with the acting owner. Honest limit: whoever holds the link could use it first — acceptable inside their own business, which is why it is single-use, short-lived, shown once and audited.
  - **Change password** `POST /api/auth/password/change`: needs the current password (a wrong one counts toward the account lock), ends all OTHER sessions, keeps this one, cancels outstanding reset links, sends a notice.
  - **Your sessions** `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id` (own sessions only; someone else's id looks like a nonexistent one; the current session must use "Log out"), `POST /api/auth/sessions/revoke-others`.
  - **UI:** Forgot password and Choose-a-new-password pages, "Forgot your password?" on login, Account & security page (change password, devices with "This device", log out one/all others), Team page "Reset link" button using the shared one-time link panel.
  - **Tests (3e):** server +53 (32 password/reset/assisted/change/sessions integration, 21 unit for mailer, config, templates, background tasks); route-coverage and role-matrix updated (the coverage test refused the new public routes until they were listed on purpose); client +39. Mutation-checked: allowing reset links for people in other businesses fails 2 tests; not ending sessions on reset fails 1. Whole repo **646/646** (119 + 422 + 105), 2026-10-25.
  - Setup for real email: see README "Email (optional)". **Not tested against the real Brevo service** (needs your API key and verified sender); the request shape is tested with a stubbed `fetch`. Brevo limits and pricing change; check their current plan.

- [x] **CI fix (2026-10-25):** the first CI run on the Phase 3 pull request was cancelled at the 15-minute limit. Cause: the server tests take ~5 minutes locally and far longer on GitHub's servers, which are a long way from Neon in Singapore (every query is slower). Fixes: (1) test files now run in parallel (4 workers) — each file uses its own e-mail domain and cleans up only its own data; a start-of-run sweep removes leftovers; one test that compared table-wide business counts was rewritten to be scoped; (2) CI is split into two jobs — shared + client + build (no database, 10-minute limit) and server (40-minute limit, one run at a time on the test database). **Local server suite: 313 s → 85 s**, 422/422 on three consecutive runs, 0 leftover rows. Not yet seen passing on GitHub; expected well under the limit.

### Phase 3 summary
Done: registration, login/logout, server-side sessions, CSRF, rate limits, lockout; business membership and active-business selection; roles and permissions enforced on the server for every route (route-coverage test); contacts API as the first tenant-scoped resource; cross-business isolation suite and role × endpoint matrix; members, link-only invitations, rank and grant rules, ownership transfer; React login, invitation, team, account pages; password reset by email or by owner, change password, session management.
Known gaps / later: Settings UI for per-member permission overrides and ownership transfer; platform-admin screens and a way to create the first platform admin; RBAC/isolation tests must be extended by hand for each new Phase 4 module (the coverage test forces guards, not tests); UI not yet reviewed by eye on small screens; real Brevo delivery untested; Render/CI not yet exercised.
- Note: duplicate-email registration returns 409 (reveals that the email exists). Accepted trade-off for usability; mitigated by the registration rate limit.
- Note: no platform administrator account can be created yet (admin module comes with Phase 4/5); `is_platform_admin` can only be set directly in the database.
- [ ] (old item) Business context + permission middleware + route-guard coverage test → see 3b
- [ ] Members, invitations, roles, overrides, rank rules
- [ ] Frontend auth flow + protected routes
- [ ] Cross-tenant isolation + RBAC matrix test suites passing
- [ ] Password reset

## Phase 4 — Core business features

- [x] **4a Ledger engine (server)** — accounting rules, transactions table, direct entries, opening balances, contact ledger, balances
  - **Rules written first:** `docs/accounting-conventions.md` (Dr/Cr = they owe you more/less; balance = debits − credits; "You gave" = debit, "You got" = credit; opening balance is a normal transaction; posted entries immutable; void/correct; running-balance ordering; reference numbers; money; dates). Shared vocabulary in `shared/ledger.js`.
  - **Database (migration 005):** `transactions` (all six types and three statuses; fixed debit/credit per type; positive amounts; composite foreign keys so a transaction can only reference a contact of its own business; unique numbers per business and type; one active opening balance per contact) and `document_sequences`. A trigger makes posted rows immutable (only description, notes and external reference may change; voiding is allowed; voided rows are frozen; no deletes), enforced even against direct SQL.
  - **Reference numbers** like `LE-2082/83-0001`: business prefix + fiscal year of the transaction date + counter, allocated inside the saving transaction (no duplicates under concurrency, not used up by a failed save).
  - **API:** `GET/POST /api/ledger/entries`, `GET/PATCH /api/ledger/entries/:id`, `POST …/void` (reason required), `POST …/correct` (void + linked replacement in one transaction), `GET /api/ledger/contacts/:contactId` (brought-forward balance, lines with debit/credit/running balance, totals, closing balance, date filter, search, pagination), `PUT/DELETE /api/contacts/:id/opening-balance`. Contacts now return `balance` (and `openingBalance` on the detail view) and accept an opening balance at creation (atomic). Balances are always calculated, never stored, and hidden from people without `ledger.view`. A first opening balance needs `ledger.create`; replacing or removing one needs `ledger.correct`.
  - **Tests (4a):** database rules 38, ledger API 49, shared 15, plus ledger cases in the isolation suite (10) and role matrix (9 endpoints × 5 roles, 4 permission-combination cases). Whole repo **807/807** (134 shared + 568 server + 105 client), 2026-10-25. Mutation-checked: removing the business filter on ledger lookups fails isolation tests; making "You got" a debit fails the balance test.
  - The development database now has the contacts and transactions tables (the Phase 3 contacts migration had not been applied there yet).
  - **Not built yet:** the screens (contacts list and detail, Add Ledger Entry form, contact ledger page) and CSV/PDF/print for the ledger (planned with 4g).
- [x] **4b Contacts & ledger screens** (React, `client/src/features/contacts`, `client/src/features/ledger`)
  - **Contacts list** `/contacts`: search (after typing pauses), type and archived filters kept in the URL, pagination, balance in plain words ("Owes you रु 5,000.00" / "You owe रु 300.00" / "Settled", never a bare minus sign), balance column hidden without `ledger.view`, empty and no-match states.
  - **Add / edit contact** `/contacts/new`, `/contacts/:id/edit`: only name and type required; several types at once; server messages next to the right fields; optional opening balance on creation (who owes whom, amount, as-of date) for people who may create ledger entries.
  - **Contact page** `/contacts/:id`: balance in words, details, Add ledger entry / Edit / Archive (with confirmation), opening balance card (add, change in a dialog, remove with confirmation; changing needs `ledger.correct`), and the **contact ledger**: date range, search, paging, brought-forward / totals / closing balance, each line with debit, credit and running balance, **Void** (reason required) and **Correct** (starts from the old values) dialogs, read-only for archived contacts and for people without `ledger.correct`.
  - **View Ledger** `/ledger`: all direct entries and opening balances, status/date/search filters, voided entries marked.
  - **Add Ledger Entry** `/ledger/new` (from the sidebar, the dashboard and the contact page; `?contactId=` pre-fills): contact picker, "You gave / You got" cards that spell out the meaning for this contact, amount, date, description, own reference, and a **live sentence** that states the result before saving ("You gave रु 2,000.00. Ram Bahadur will owe you रु 7,000.00." / "…You will owe Ram Bahadur रु 1,500.50." / "…account will be settled."; only the first half when balances are hidden). "Save" or "Save and add another".
  - **Dates:** `DateField` accepts BS or AD, shows the same day in the other calendar, hands the form the AD date; the business's `dateDisplay` (BS by default) now comes with the session and tables show dates in that calendar. Server change: `activeBusiness.dateDisplay` added to the session payload.
  - New shared piece: `describeOutcome` in `shared/ledger.js`.
  - **Tests (4b):** client +78 (183 total): date field 13, contacts list/form/page/opening balance 32, ledger table/void/correct/all-entries/entry form 33; shared +5. Whole repo **890/890** (139 shared + 568 server + 183 client), 2026-10-25. Test bugs found along the way were in the tests themselves (fixture shape, wording); no app bug surfaced beyond what the earlier steps' tests had already caught.
  - **Not checked in a real browser** (only by automated tests with a fake server): please try `npm run dev` — add a contact with an opening balance, add entries, void and correct one, switch BS/AD.
  - **Not built yet:** CSV/PDF export and printing of the ledger (4g), Settings screen to change the BS/AD preference (4h), BS/AD in the dashboard filters (4f).
- [x] **4c Sales & purchases engine (server)** — invoice/bill lines, discounts, VAT, drafts, post, void; plus the Settings API it needs
  - **Plan for the rest of Phase 4:** 4d sales & purchases screens · 4e receipts & payments + allocations (server) · 4f their screens · 4g dashboard & reports · 4h print & CSV export · 4i settings screen.
  - **Calculation** (`shared/invoice.js`, rules in `docs/accounting-conventions.md` §10): per line gross → line discount → share of the invoice discount (spread in proportion, exactly, BEFORE VAT) → net → VAT (per line, rounded once) → total; totals = taxable + non-taxable + VAT. Property-tested on 400 random documents (total = subtotal − discount + VAT; shares add up exactly; nothing negative).
  - **Database (migration 006):** `transaction_lines` (positive quantities, line total must equal gross − discounts + VAT, taxable ⇔ has a rate, same-business composite key) and a trigger that makes the lines of a posted or voided document immutable, even to direct SQL.
  - **VAT:** nothing assumed. A business is not VAT-registered unless it says so; taxable lines need a rate (the line's own, or the business default); 0% differs from "not taxable"; the rate is copied onto the line so later rate changes never alter history.
  - **API** (`/api/sales`, `/api/purchases`, one implementation): list (status/contact/date/search/paging), create draft or `post: true`, get with lines, `PATCH` (draft: change anything, send lines again to change amounts; posted: notes and reference only), `DELETE` (drafts only), `POST /:id/post`, `POST /:id/void` (reason required). Numbers `SI-2082/83-0001` / `PB-…` from the document date's fiscal year; due date = given date, else date + the business's credit days, else none. Sales debit the contact, purchases credit them; a contact who is both has one net balance. Contact ledger lines now include invoices and bills.
  - **Settings API** (`GET/PATCH /api/settings`, `PATCH /api/businesses/current`): date display, VAT registration, default VAT rate, default credit days, numbering prefixes (only affect new documents), invoice footer; business profile (name, address, PAN, VAT number). Audited with before/after of what changed; the session now carries the date preference.
  - **Tests (4c):** shared +14 (invoice maths), database +22 (lines), sales 57 + purchases 57 + together 2, settings 34, isolation of documents 17, role matrix +17 endpoints × 5 roles. Whole repo **1,175/1,175** (153 shared + 839 server + 183 client), 2026-10-25. Mutation-checked: dropping the business filter, dropping the sale/purchase separation, and allowing VAT for unregistered businesses each fail tests.
  - CI time: the sales and purchases suites run as separate files in parallel (91 s instead of 199 s locally).
  - **Not yet:** screens (4d); paid / outstanding amounts (come with allocations in 4e); print/PDF (4h); "copy as new draft".
- [x] **4d Sales & purchases screens, and the Settings screen** (`client/src/features/documents`, `client/src/features/settings`)
  - **Lists** `/sales`, `/purchases`: number (or "Draft"), contact, due date, total, status; status/date/search filters; create button only for those who may.
  - **Form** `/sales/new`, `/purchases/new`, `/…/:id/edit` (drafts only; `?contactId=` pre-fills): contact, date, optional due date (shows the date the credit-days default would give), reference ("Supplier's bill number" for purchases), item rows (item, quantity, unit, price, discount, and "Charge VAT" + rate only when the business is VAT-registered), discount on the whole document, notes. A **live total** uses the same rules as the server (`shared/invoice.js`): subtotal, discount, taxable / non-taxable / VAT (VAT parts only when VAT is on), total, and a sentence saying what **posting** will do to the contact's account ("After posting: Ram Bahadur will owe you रु 5,200." / "You will owe … "). Blank rows are ignored; a bad row is highlighted with the reason and holds back the total; server messages land on the right row even when blank rows were skipped. "Save draft" or "Save and post"; editing a draft can post it too.
  - **Document page**: draft banner; Post (with a confirmation that explains what posting means), Edit, Delete draft (two steps); posted: Void (reason required) and "Edit notes and reference" only; voided: reason shown, no actions; items table with discount (line + share of the whole-document discount) and VAT columns only when the document has VAT; totals breakdown. Permissions respected (a viewer sees no buttons; staff can post but not void).
  - **Contact page and ledger**: invoices and bills appear with a badge and link to their page; "New sales invoice" / "Record purchase" start one for that contact.
  - **Settings screen** `/settings`: business details (name, legal name, address, phone, email, PAN, VAT number) and tax/dates/numbering (BS or AD display, VAT registration, default VAT rate with no rate assumed, default credit days, six number prefixes, invoice footer). Read-only with a clear note for people without the permission. Saving refreshes the session so dates and the business name change straight away. (This completes the settings screen planned as 4i.)
  - **Tests (4d):** client +66 (249 total): preview maths 11, list/form/page/ledger-links 44, settings 11; shared +1; one server test that sends exactly the shape the form sends (blank optional fields as empty text, `dueDate: null`). Whole repo **1,244/1,244** (154 shared + 841 server + 249 client), 2026-10-25. The client suite waits up to 5 s for screens to appear (was 1 s) because three tests timed out only when the whole suite competed for one CPU.
  - Not checked in a real browser. Please try: Settings → turn on VAT with your rate → New sales invoice → add items with VAT → Save and post → open the contact → Void.
  - **Not built yet:** paid / outstanding amounts and receipts & payments (4e–4f); print and PDF (4h); "copy as new draft".
  - **Fix after first use (2026-10-25):** the main **Ledger** page listed only direct entries and opening balances, so a posted sales invoice showed in the customer's account but not on the Ledger page. It now lists every posted or voided transaction (never drafts): invoices, bills, direct entries, opening balances (and receipts/payments when they exist), each labelled, with invoices and bills linking to their own page, a "type" filter, and a plain-words "they owe you more / less" under each amount. `GET /api/ledger/entries` accepts `type=sale|purchase|receipt|payment|ledger_entry|opening_balance|all`; invoices report `direction: null` because they have no You gave / You got choice. Void/correct of entries is still only for direct entries. Regression tests for sales and purchases + client; mutation-checked (restoring the old restriction fails the new test). Whole repo 1,248/1,248 (154 + 843 + 251).
- [x] **4e Receipts & payments with allocations (server)** (`server/src/modules/settlements`, `shared/allocation.js`, migration 007)
  - `/api/receipts` (money in, settles sales invoices, a credit) and `/api/payments` (money out, settles purchase bills, a debit): create, list, get, text-only edit, void, `PUT /:id/allocations` (replace), `POST /:id/auto-allocate` (oldest first), `GET /open-documents?contactId` (the "apply to…" picker). Numbers `RC-`/`PM-` per fiscal year; six methods (cash, bank transfer, cheque, eSewa, Khalti, other).
  - **Allocation**: a receipt/payment may be applied to posted documents of the same contact; total applied ≤ the amount and ≤ each document's total. What is left is an **advance** (still counts toward the balance). Applying never changes a balance. Invoices/bills now report `paid`, `outstanding`, `paymentStatus` (unpaid / partially_paid / paid), `overdue`, and the payments applied; the list takes `payment=unpaid|partial|paid|open|overdue`.
  - **Voiding** a receipt/payment releases its allocations; voiding an invoice releases the payments applied to it (they become advances). The database enforces all of it (pairing, same contact, posted, no over-allocation under simultaneous requests via ordered row locks, void blocked while allocations are live), so a bug in the app cannot over-allocate.
  - **Tests (4e):** shared +12, DB rules 19, API 52 per kind (104), run identically for receipts and payments. Server 966/966 passing. Client: one test (`documents.test.jsx`, "starts with one empty row…") timed out once during the full parallel run and passed 3/3 alone, so it is load-sensitive; this step did not touch the client.
  - **Known gaps:** the role matrix and cross-business isolation suites do not list the new endpoints separately (the route-guard coverage test and each suite's own other-business checks cover them); the closing "books stay consistent" test is a light sanity check, not an independent recomputation. No screens yet (4f).
- [x] Paid status / overdue (server, in 4e)
- [x] **4f Receipts & payments screens** (`client/src/features/settlements`)
  - `/receipts-payments` (tabs Receipts / Payments, only those the person may view; filters: dates, method, active/voided, advances only, search); `/receipts-payments/new-receipt` and `/new-payment` (contact, amount, date, method, reference, then a table of the contact's unpaid invoices/bills with an amount box each and **Apply oldest first**; a live line says how much is applied and how much stays as an advance, and saving is blocked if more is applied than received); detail pages for each (what it paid, apply an advance later, void with reason and a warning that invoices become unpaid, edit notes).
  - Invoice and bill pages now show paid / outstanding / Unpaid-Part paid-Paid / Overdue, the receipts or payments applied, and a "Record receipt/payment" button that starts with that document applied; the lists have a Payment filter and an Outstanding column. Contact page has Record receipt / Record payment. Receipts and payments link from the Ledger and the contact account.
  - Tests: client +20 (269 total). Not checked in a real browser.
- [ ] Dashboard & reports
- [ ] Print & CSV export
- [ ] Settings + BS/AD everywhere

## Phase 5 — Hardening

- [ ] Authorization gap review (+ optional RLS)
- [ ] Financial consistency tests
- [ ] Edge-case tests
- [ ] Responsive/usability polish
- [ ] Install / deploy / backup / restore docs

---

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-24 | Server-side sessions (opaque cookie, hashed in DB) instead of JWT | Immediate revocation on suspension/deactivation |
| 2026-10-24 | Active business held on the session, never trusted from client input | Prevents cross-tenant access via tampered `business_id` |
| 2026-10-24 | Balances computed from posted transactions, not stored | Single source of truth; no drift |
| 2026-10-24 | Composite FKs `(business_id, id)` on all tenant child tables | DB-level guarantee against cross-tenant links |
| 2026-10-24 | Posted records immutable; void + correct workflow | Audit integrity |
| 2026-10-24 | Raw parameterized SQL via `pg` + `node-pg-migrate` (no ORM) | Explicit tenant scoping, transactions, window functions |
| 2026-10-24 | All plan.md §13 defaults accepted | Owner instruction |
| 2026-10-24 | PostgreSQL hosted on Neon (pooled URL for app, direct URL for migrations, separate branch for tests) | No local DB install |
| 2026-10-24 | Deploy to Render as a single Web Service (Express serves API + built React) | Same-origin cookies, one service |

## Open questions

None outstanding. Resolved items are in plan.md §13.
