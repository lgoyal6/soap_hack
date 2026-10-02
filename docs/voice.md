# Voice paralegal (owner: Laksh)

`components/voice/VoiceDock.tsx` on the firm page. Hold space to talk (Chrome), or type. Same agent either way.

## Turn

Browser -> `POST /api/voice` (firm only) -> `lib/voice/agent.ts` -> model with tools (`lib/voice/tools.ts`) ->
each sentence checked (`lib/voice/check.ts`) -> streamed back as newline-delimited JSON -> spoken one sentence at a time.

- The model knows the case only through tools: contract A (`get_summary`, `get_open_items`, `get_conflicts`, `get_money`,
  `get_not_done`, `get_changes`, `search_records`, `get_related`, `get_record`, `list_providers`, `get_timeline`)
  plus `show`, `play_replay` and `create_draft`.
- Every source in a tool result is replaced by a number; the model ends sentences with `[n]`. Those become the source
  chips and the `casebrief:chips` event. The section a source came from becomes a `casebrief:show` event, so the page
  scrolls as the answer is spoken. `show` and `play_replay` fire `casebrief:show` and `casebrief:replay` directly.
- Arrays come with a `count`, so the model never counts.

## Sentence check (trust rule 1)

A sentence is dropped, not shown and not spoken, if it states a number (digits or number words) that is not in any
tool result of this conversation, the user's own words, or today's date. Ids and source numbers do not count as
allowed numbers. Dropped sentences are logged in `voice_turns.dropped`, and the dock says a sentence was withheld.
Drafts go through the same check; a draft with an unsupported number is refused and the model is told why.

## Speech

- In: Chrome's speech recognition while space is held. Space while it is thinking or speaking stops the audio and
  aborts the request (the model call is aborted server-side too).
- Out: `POST /api/voice/tts` uses `TTS_MODEL` through GMI's OpenAI-style `/audio/speech` (voice from `TTS_VOICE`,
  default `alloy`). If `TTS_MODEL` is empty or the call fails, it answers 204 and the browser's own voice is used.
  The "Speak" box turns speech off; captions and page movement still work.

## Text a summary to your phone (iMessage)

Say or type "text me a summary" and the agent gathers the facts, then calls `send_imessage`.
`lib/voice/imessage.ts` sends it with `osascript` through Messages.app on the Mac running `npm run dev`.

- The recipient is only `IMESSAGE_TO` from `.env` (your phone number or Apple ID email). The model cannot pick it.
- It sends only when the attorney's own message this turn asks for a text, so instructions inside case records cannot trigger it.
- The text goes through the same number check as speech and has the source markers removed.
- Each send is logged in `outbox` with reason `imessage` (hidden from the provider outbox list).
- First send: macOS asks whether Terminal (or your editor) may control Messages. Allow it, or enable it later in
  System Settings > Privacy & Security > Automation. Messages must be signed in to iMessage.
- Not on a Mac, or `IMESSAGE_TO` empty: the tool refuses and the agent says it could not send.

## Memory, drafts, logs

- Conversation history is kept per firm user and case on the server, so follow-ups work. "New conversation" clears it.
- On open the dock offers "Brief me" (about a minute, then what changed since the last visit) and "What changed".
- Drafts are saved in `drafts` with a Copy button. Never sent, never written to Clio.
- `voice_turns`: question, answer, dropped sentences, tools called, time to first checked sentence, time to first
  audio (reported by the browser), total time, tokens. Every model round is also in `llm_calls` with purpose `voice`.

## Env

`GMI_API_KEY`, `GMI_BASE_URL`, `LLM_MODEL`; optional `TTS_MODEL`, `TTS_VOICE`, `IMESSAGE_TO`.

## Test

`node --experimental-strip-types --test tests/voice/*.test.ts` covers the number check, source markers and sentence splitting.
