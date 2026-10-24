# LedgerNepal — Progress Log

> Plan: [plan.md](plan.md) · Requirements: [requiremend.md](requiremend.md)
> Rule: a step is only ticked when it is implemented **and** its tests pass (with real output recorded).

## Current status

| Phase | Status |
|---|---|
| 1. Requirements & architecture | ✅ Approved — all defaults accepted (plan.md §13) |
| 2. Project foundation | ✅ Done (2a–2d). 184 automated tests passing (shared 119, server 51, client 14). Branch `phase2-foundation`, ready to merge. |
| 3. Authentication & authorization | ✅ Done (3a–3e). 646 automated tests passing (shared 119, server 422, client 105). Branch `phase3-auth`, ready to merge. |
| 4. Core business features | ⚪ Not started |
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

- [ ] Contacts
- [ ] Direct ledger entries + contact ledger
- [ ] Sales & purchases
- [ ] Receipts & payments + allocations
- [ ] Paid status / overdue / consistency tests
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
