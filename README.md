# LedgerNepal

Multi-tenant digital bahi-khata for small businesses in Nepal.
React + Vite (client) · Express (server) · PostgreSQL on Neon · deployed on Render.

- Requirements: [requiremend.md](requiremend.md)
- Architecture and phased plan: [plan.md](plan.md)
- What is done and what is next: [progress.md](progress.md)

## Layout

| Folder | What it is |
|---|---|
| `client/` | React app (Vite, React Router, Tailwind, React Query) |
| `server/` | Express API, migrations, seeds, server tests |
| `shared/` | Code used by both: permissions matrix, money rules, BS/AD dates |

## First-time setup (Linux / WSL)

Requires Node 22+.

```bash
npm install
cp .env.example .env     # then fill in the Neon URLs (never commit .env)
npm run db:check         # confirms all configured database URLs connect
npm run db:migrate       # creates tables, seeds roles and permissions
```

`.env` needs `DATABASE_URL` (Neon pooled), `DATABASE_URL_DIRECT` (Neon direct, used for migrations)
and `TEST_DATABASE_URL` (a separate Neon branch: **tests wipe and seed it**).

## Everyday commands

```bash
npm run dev              # API on :4000 + Vite on :5173 (open http://localhost:5173)
npm test                 # shared + server + client tests
npm run build            # production client build into client/dist
npm start                # production server (serves API and client/dist on one port)

npm run db:migrate       # apply pending migrations and sync roles/permissions
npm run db:migrate:down  # revert the most recent migration (one step)
npm run db:status        # list applied migrations
```

## Writing server tests

Server test files run **in parallel** against one real Neon test branch, which is what keeps the suite at
about a minute and a half instead of five. That works because every file creates and removes only its own
data (each file gets its own e-mail domain, see `server/tests/helpers/api.js`). So in a test:

- create users with `registerUser` / `createMemberSession` / `uniqueEmail`, never fixed e-mail addresses;
- never assert on table-wide counts (`SELECT count(*) FROM businesses`) or delete other files' rows; scope by
  ids or unique names you created;
- add every new business endpoint to the role matrix and cross-business isolation tests.

## Email (optional)

Invitations never use email: the inviter copies a link and shares it (e.g. on WhatsApp).
Email is used for one thing only: **"Forgot password"**. Without it, an owner or administrator can still
create a reset link for a team member (Team page → *Reset link*) and send it by hand.

To send real reset emails with [Brevo](https://www.brevo.com) (free plan, works on Render, no domain needed):

1. Create a Brevo account and verify a sender address: *Senders, Domains & Dedicated IPs → Senders*.
   (An address on a free provider such as Gmail may be filtered to spam; a domain you own is more reliable.)
2. Create an API key: *SMTP & API → API Keys*.
3. Set `MAIL_PROVIDER=brevo`, `BREVO_API_KEY` and `MAIL_FROM_EMAIL` in `.env` (locally) or the Render dashboard.

Locally, with nothing set, emails are printed in the server log (including the reset link). In production
the console provider is refused on purpose, because it would put reset links in the logs. Free-plan limits
change; check Brevo's current numbers.

## Git workflow

Work on a branch, open a pull request, let CI pass, merge into `main`. Render deploys `main`.
CI needs a repository secret named `TEST_DATABASE_URL` (GitHub: Settings → Secrets and variables → Actions).

## Deploying to Render

See [render.yaml](render.yaml). Set `APP_ORIGIN`, `DATABASE_URL` and `DATABASE_URL_DIRECT` in the Render dashboard.
This has not been deployed yet; the first deploy will verify it.
