# LedgerNepal — Progress Log

> Plan: [plan.md](plan.md) · Requirements: [requiremend.md](requiremend.md)
> Rule: a step is only ticked when it is implemented **and** its tests pass (with real output recorded).

## Current status

| Phase | Status |
|---|---|
| 1. Requirements & architecture | ✅ Approved — all defaults accepted (plan.md §13) |
| 2. Project foundation | 🟡 In progress — steps 2a, 2b, 2c done; 2d (money/dates libs + CI) remaining (branch `phase2-foundation`) |
| 3. Authentication & authorization | ⚪ Not started |
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
- [ ] Money + BS/AD date libraries with unit tests (step 2d)
- [ ] GitHub Actions workflow running tests on pull requests (step 2d; needs `TEST_DATABASE_URL` as a repo secret)
- [ ] `render.yaml` / Render settings (build: `npm ci && npm run build`, start: `npm start`, health check `/api/health/ready`) — written in 2d or Phase 5

## Phase 3 — Authentication & authorization

- [ ] Register / login / logout / me / CSRF / rate limits
- [ ] Sessions, revocation, suspension, active-business switch
- [ ] Business context + permission middleware + route-guard coverage test
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
