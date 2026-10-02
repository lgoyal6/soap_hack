# Laksh: provider portal and voice, Oct 2

## Done and working (tested against the seed matter and a mock model server)
- Provider portal: `lib/portal/**`, `app/login`, `app/provider/**`, `app/api/{auth,share,provider}/**`, `components/{provider,share}/**`. See `docs/portal.md`.
- Voice agent: `lib/voice/**`, `app/api/voice/**`, `components/voice/VoiceDock.tsx`. See `docs/voice.md`.
- Tests: `tests/portal/access.test.ts` (needs the dev server), `tests/voice/check.test.ts`. All pass, with Tijil's pipeline tests.

## Not yet tested
- A real GMI model (no key in the build session). Tool calling was tested only with a mock OpenAI-style server.
  First thing to check with the key: one typed question on the real case.
- GMI text-to-speech: the route falls back to the browser voice if the call fails.

## Schema
`db/02_portal_voice.sql` changed (new columns on users, shared_items, outbox, voice_turns; new `stage_seen` table).
Reset: `docker compose down -v && docker compose up -d`, then sync again.

## Asks for Tijil (his files, not edited)
- `.env.example`: add `TTS_VOICE=` (optional voice name for GMI TTS).
- `/api/case/*` returns 401 to a provider; the plan says 403. The access test accepts either.
- The dock lives in the fixed bottom box in `FirmBrief.tsx`; it can grow up to about 450px tall when the transcript
  and drafts are open. If that covers too much, cap the box height there.
