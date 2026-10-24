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

## Git workflow

Work on a branch, open a pull request, let CI pass, merge into `main`. Render deploys `main`.
CI needs a repository secret named `TEST_DATABASE_URL` (GitHub: Settings → Secrets and variables → Actions).

## Deploying to Render

See [render.yaml](render.yaml). Set `APP_ORIGIN`, `DATABASE_URL` and `DATABASE_URL_DIRECT` in the Render dashboard.
This has not been deployed yet; the first deploy will verify it.
