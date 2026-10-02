# Submission notes

## What it is
Casebrief reads one personal-injury matter live from Clio Manage (read-only) and gives the firm a
ninety-second brief with a voice paralegal, and each treating provider its own login showing only
what the attorney published, where the provider answers the firm's requests with one click.

- Firm: `/dashboard` (ninety-second home) and `/firm` (full one-page brief).
- Provider: `/provider`, signed in with the provider's Clio email plus an access code the firm generates.

## Stack
- Next.js 16 (App Router), TypeScript, Tailwind, Motion.
- Postgres 16 in Docker (our own database; Clio is never written to).
- Clio Manage API v4, GET only, through `lib/clio.ts`.
- Models through GMI Cloud's OpenAI-style API. Model ids are set in `.env`, not in code.

## Models used on the Sapini matter
- Building the brief (threads, conflicts, not-yet-done, witness check, summary, what is new): `openai/gpt-6.1-sol`.
- Reading records and document pages: `google/gemini-3.5-flash-lite`.
- Voice paralegal: `deepseek-ai/DeepSeek-V4.1-Flash` (chosen after benchmarking 14 models for speed and correctness).
- Speech in and out: the browser (Chrome speech recognition and speech synthesis). GMI offered no speech model on our key.

## Cost for one case (measured token counts from the `llm_calls` table)
- Brief, one time: about 62,000 input and 33,000 output tokens across 36 calls.
- Reading 166 document pages, one time: about 127,000 input and 68,000 output tokens.
- Reopening the case: no model calls. Sections are cached; only changed records are re-read.
- Voice: about 12,000 input and 800 output tokens per question; first words in about 3 to 9 seconds.
Dollar cost depends on GMI's per-model prices, which we did not look up; the token counts above are measured.

## Where data lives
Everything we create (facts with their quotes, cached sections, logins, shared items, provider replies, drafts,
token log) is in our Postgres database. Nothing is written back to Clio.

## Trust rules enforced in code
- The model never supplies a number: counts, dates, days and money are computed by code (`lib/pipeline/compute.ts`, tested).
- Every extracted fact carries a verbatim quote; the quote must be found in its record and any number must be in the quote, or the fact is dropped.
- Model-written sentences (summary, what is new, voice) are dropped if they contain a number their sources do not.
- Limitations status comes from the firm's own task, never computed.
- The provider portal reads only what was published, with consent per category; coverage is off by default.

## Not finished or limited (please account for these)
- Search is keyword-only; no embeddings.
- 4 of 166 document pages failed to read and are shown as such in the page count.
- Some old requests that were in fact answered still appear as open items (the model did not mark the reply as resolving).
- The top-ten ranker learns from pins and dismissals with a simple weight update; it is a mechanism, not a trained model.
- Provider emails go to an outbox table and are not sent (the test contacts have fake addresses).
- "Text me" by iMessage works only on a Mac with Messages signed in; untested by us end to end.
- The crash illustration is generic and labelled as an illustration.
- No case-specific values are in code or prompts; `tests/pipeline/seed.sql` and `fixtures/case.ts` hold a made-up matter used for tests.

## Where to look first
`lib/pipeline/compute.ts` and its tests, `lib/pipeline/process.ts`, `lib/clio.ts`, `lib/voice/check.ts`, `lib/portal/provider.ts`.
