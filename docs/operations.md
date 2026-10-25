# Operations: deploy, back up, restore

LedgerNepal runs as **one Render web service** (it serves the API and the built React app) with its data in **Neon Postgres**.

> **Status.** None of this has been run against a real Render account yet. The steps below follow how the app is built and what `render.yaml` declares; the first deploy is the test of them. Where a number depends on Neon's or Render's current plan limits, check their pages instead of trusting this one.

## 1. First deploy to Render

1. Push the code to GitHub and merge it into `main` (Render deploys `main`).
2. In Render: **New → Blueprint**, pick the repository. It reads [render.yaml](../render.yaml).
3. Fill in the three values Render asks for (they are never stored in git):

   | Variable | Value |
   |---|---|
   | `APP_ORIGIN` | The public address, e.g. `https://ledgernepal.onrender.com`. Used for the CSRF/origin check and links in emails. Must match exactly, with no trailing slash. |
   | `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`). Used by the running app. |
   | `DATABASE_URL_DIRECT` | Neon **direct** connection string (no `-pooler`). Used only by the migration step during the build. |

4. Optional, for "Forgot password" emails: `MAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `MAIL_FROM_EMAIL` (see the README). Without them the app works and owners can create reset links by hand from the Team page.
5. Deploy. The build runs `npm ci`, builds the client, then **applies pending migrations** against `DATABASE_URL_DIRECT`. If a migration fails the deploy fails and the previous version keeps running.
6. Open `https://<your-app>/api/health/ready`: it should answer `{"data":{"status":"ok","database":"ok"}}`. Render uses the same address as its health check.
7. Register the first account on the login page. That person becomes the Owner of the first business.

Other things to know:

- **Free tier sleeps.** A free Render web service stops after a period without traffic and takes a while to start again. Fine for trying it out; for daily use choose a plan that stays on. Neon's free compute also suspends when idle and wakes on the first request.
- **One instance.** Sessions, rate limits and the mail outbox live in the database or in memory of that one process. Do not scale to several instances without moving the in-memory rate limiter to a shared store.
- **Cookies.** The session cookie is `Secure` and `HttpOnly` in production; the app must be served over HTTPS (Render does this).
- **TRUST_PROXY=1** is already set so client IPs and secure cookies are read correctly behind Render's proxy.

## 2. Everyday operations

| Task | How |
|---|---|
| See what is deployed | Render dashboard → the service → Events/Logs. |
| Is it healthy? | `GET /api/health/ready` (checks the database too). |
| Add a feature | Branch → pull request → CI must pass → merge to `main` → Render redeploys. |
| Apply a migration | It is part of the build (`npm run db:migrate`). Never edit an applied migration; add a new one. |
| Check the data is whole | `npm run db:verify` (see §4). Read-only. |
| Rotate the database password | Neon → the role → reset password → update `DATABASE_URL` and `DATABASE_URL_DIRECT` in Render → redeploy. Update your local `.env` too. |
| Help someone who forgot their password | Team page → **Reset link** (Owner/Administrator), then send them the link. |
| Regenerate API/permission docs | `npm run docs`. A test fails if they are stale. |

Logs are one JSON line per request with a request id. Passwords, tokens, cookies and query strings are never written to them. Every change to business data also writes an **audit entry** (who, what, before/after) that the application cannot edit or delete.

## 3. Backups

Your accounts are the only copy of your data, so use **two independent layers**:

1. **Neon's built-in history (restore to a past moment).** Neon keeps a window of history you can restore from or branch off; how long depends on your plan. In the Neon console: *Branches → Restore* (to a timestamp), or create a branch from a past point to look at old data without touching the live one. Check the retention shown for your plan and make sure it is long enough for how quickly you would notice a mistake.
2. **Your own export with `pg_dump` (a file you hold).** This protects against losing the Neon project itself, and is what you can keep offline. Run it from any machine with PostgreSQL client tools (version at least equal to Neon's):

   ```bash
   # Direct (non-pooled) URL. Custom format is compressed and restores selectively.
   pg_dump "$DATABASE_URL_DIRECT" --format=custom --no-owner --file="ledgernepal-$(date +%F).dump"
   ```

   Do this on a schedule that matches what you could bear to redo (daily for an active business, at least weekly), keep several generations, and store the files somewhere other than the laptop that runs the app. The dump contains financial data: treat the file like the database itself (encrypted disk or cloud storage, no email attachments).

## 4. Restore drill (do this once before you rely on it, then each quarter)

A backup you have never restored is a hope, not a backup. The drill restores into a **separate, empty** database so the live one is never touched.

1. In Neon create a new empty branch/database for the drill (or a new project). Copy its **direct** connection string; call it `RESTORE_URL`.
2. Restore the dump:

   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_URL" ledgernepal-YYYY-MM-DD.dump
   ```

   (A Neon *branch restore* needs no `pg_restore`: restore or branch, then skip to step 3.)
3. Check the copy is whole:

   ```bash
   npm run db:verify -- "$RESTORE_URL"
   ```

   It confirms the rules the books depend on (nothing paid twice, allocations within amounts, unique and complete numbering, totals equal their lines, nothing crossing businesses) and prints, per business, the number of contacts and posted/voided entries and the net balance. **Compare those counts and balances with the live system** (`npm run db:verify` against production, or the dashboard). They must match, to the paisa, for the moment the dump was taken.
4. Optionally point a local copy of the app at `RESTORE_URL` (`DATABASE_URL=... npm run dev`), log in and open a few ledgers.
5. Delete the drill database. Write down the date and the result.

**Restoring for real** (data lost or damaged): prefer a Neon point-in-time restore of the affected branch if the damage is recent. Otherwise restore the latest dump into a new Neon database, run `npm run db:verify` on it, then change `DATABASE_URL` and `DATABASE_URL_DIRECT` in Render to point at it and redeploy. Keep the damaged database until you are sure nothing else is needed from it. People logged in will have to log in again only if the `sessions` table was not part of the restore.

## 5. Going wrong

| Symptom | Likely cause | What to do |
|---|---|---|
| Deploy fails at the migration step | A migration error or a wrong `DATABASE_URL_DIRECT` | Read the build log. The old version is still serving. Fix and push; never edit an already-applied migration. |
| Everyone gets "Origin not allowed" / writes fail with 403 | `APP_ORIGIN` does not exactly match the address in the browser | Correct the variable, redeploy. |
| Login works but the next page logs you out | Not served over HTTPS, or `TRUST_PROXY` unset | Use the https address; keep `TRUST_PROXY=1`. |
| `/api/health/ready` says the database is down | Neon suspended/unreachable, wrong password after a rotation | Open Neon, check the project; check the two URLs in Render. |
| First request after quiet is very slow | Free tiers waking up | Expected on free plans. |
| A report or balance looks wrong | A genuine data question | `npm run db:verify`; open the contact's ledger and the audit log for the entries involved. Posted entries cannot be edited, only voided, so the history explains itself. |
| Too many login attempts | The account lockout/rate limits | Wait for the lockout to expire, or an Owner can create a reset link. |

## 6. Security checklist before real use

- [ ] Neon password changed since it was first shared or pasted anywhere.
- [ ] `.env` is not committed (it is git-ignored); GitHub and Render hold the secrets, not the repo.
- [ ] `APP_ORIGIN` is the real https address.
- [ ] The first account uses a long, unique password.
- [ ] A backup has been taken **and restored** (§4).
- [ ] CI is green on `main` (it needs the `TEST_DATABASE_URL` secret).
- [ ] You have opened the app on a phone and printed one invoice to PDF to check the paper layout (this has not been verified by the developer).

## 7. Known limits

- Single amount up to **999,999,999,999.99**; balances and report totals up to 14 digits.
- Dates between **1990-01-01** and **2042-01-01**: the Bikram Sambat tables used for fiscal years and BS display stop shortly after.
- Printing uses the browser (print dialog / "Save as PDF"). There are no server-generated PDF files and no emailed invoices.
- No inventory, payroll or full profit-and-loss statements, by design (see the requirements).
- Row-Level Security in Postgres was considered and **not** added: tenant isolation is enforced by the application on every query (audited by `queryAudit.test.js`), by composite foreign keys, and by tests that attack across businesses. RLS would be an extra layer; adding it needs a per-request database role/setting and is a separate piece of work.
