# Casebrief

Reads one personal-injury case live from Clio Manage and gives the law firm a one-page brief with a
voice paralegal, and each treating medical provider a separate portal with its own login.

Built for the Swans Applied AI Hackathon. What we are building: `HANDOFF.md`. Who builds what: `BUILD_PLAN.md`.

## Run

```bash
cp .env.example .env        # then fill in the values
docker compose up -d        # Postgres with the schema in db/
npm install
npm run dev                 # http://localhost:3000
```

Sign in with Clio at `/login`, then press "Sync from Clio".

## Clio is read-only

Every Clio call goes through `lib/clio.ts`, which only issues GET requests for case data.
Everything we create (logins, shared items, replies, drafts) lives in our own Postgres database.

## Docs

- `docs/pipeline.md`, `docs/firm.md`: sync, facts, firm page
- `docs/portal.md`, `docs/voice.md`: provider portal, voice paralegal
- `docs/submission.md`: stack, models, cost per case, what is unfinished
