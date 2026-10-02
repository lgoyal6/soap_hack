# Pipeline (owner: Tijil)

Clio -> `raw_records` -> facts with quotes -> cached `sections` -> `lib/tools` (contract A).

## Run it

```bash
docker compose up -d                 # Postgres on host port 5433
npm run dev
# sign in at /login, then:
#   POST /api/sync           copies every Clio resource (GET only)
#   POST /api/case/process   builds the sections
#   GET  /api/case/<tool>?matterId=...   any tool from lib/contracts.ts as JSON
```

## Working without Clio

- `USE_FIXTURES=1` in `.env`: every tool returns the made-up case in `fixtures/case.ts`. No database rows needed.
- Or load a made-up matter in Clio's own shape and run the real pipeline on it:
  `docker compose exec -T db psql -U casebrief < tests/pipeline/seed.sql`, then `POST /api/case/process`.

## What a model does and does not do

A model labels threads, pulls quoted facts, groups facts that disagree, and writes the two or three summary sentences.
Code (`lib/pipeline/compute.ts`, tested in `tests/pipeline`) does every count, date, sum and day counter, checks that
each quote is really in its record and each number is really in its quote, and drops anything that fails.
If the model is not configured, the code-computed parts still build; model-backed sections are empty and retried on the next run.

## Notes

- Schema changed after the first push (plain Postgres image, port 5433, `provider_replies.request_id`).
  If you started the database before pulling: `docker compose down -v && docker compose up -d`.
- Search is keyword-only (Postgres full-text). Embeddings are not built.
