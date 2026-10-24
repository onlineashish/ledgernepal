# LedgerNepal — Progress Log

> Plan: [plan.md](plan.md) · Requirements: [requiremend.md](requiremend.md)
> Rule: a step is only ticked when it is implemented **and** its tests pass (with real output recorded).

## Current status

| Phase | Status |
|---|---|
| 1. Requirements & architecture | ✅ Approved — all defaults accepted (plan.md §13) |
| 2. Project foundation | ⚪ Not started |
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
- [ ] WSL prerequisites (Node LTS via nvm, git); Neon `test` branch created and URL put in `TEST_DATABASE_URL`
- [ ] git init, npm workspaces, GitHub repo + first push
- [ ] Express skeleton, config validation, logging, security middleware, error handler
- [ ] Health endpoints
- [ ] pg pool + transaction helper
- [ ] Migrations (identity, tenancy, RBAC, audit)
- [ ] Role/permission seed
- [ ] Test harness (vitest + supertest + test DB)
- [ ] React/Vite/Router/Tailwind shell
- [ ] Money + BS/AD date libraries with unit tests

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
