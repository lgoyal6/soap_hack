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

## Grounding check (`ground` in `lib/voice/check.ts`)

The number check above only asks whether a number appeared in some tool result. Every spoken sentence, draft and
text message is also checked against what it cites:

- each cited `[n]` must be a source this conversation has seen;
- each number must be stated by a cited source (`number_from_uncited_source` when another source has it);
- as the same kind of number: an amount, a date (kept whole), days, a count ("3 times", "twice") or a plain number
  (`unit_mismatch` for 120 days open spoken as "asked 120 times");
- for the party the sentence names (`entity_mismatch`, `entity_not_in_cited_source`);
- not only from a source marked stale;
- "not found" needs a search this turn, and while scanned pages are unread it must say how many pages were read.

Numbers in the attorney's own words and today's date need no source. It is a finite rule check on numbers, units and
named parties; it does not judge prose without numbers.

## Timeouts, disconnects and interruption

- A model stream that sends nothing for 30 s is abandoned; the turn ends with an error and the upstream request is closed.
  Read-only tool calls have the same bound; tools with side effects (drafts, texts) are left to finish.
- Text is checked one complete sentence at a time. After a disconnect or an interruption the unfinished tail is never
  checked, shown or spoken; after a normal end it is.
- `tests/voice/agent-network.test.ts` drives the real route, agent and `openai` SDK against a local stand-in endpoint
  (`tests/voice/model-stub.ts`): a swapped count, a dropped connection, a stalled stream, a refused connection retried
  once by the SDK, and the attorney interrupting. It does not call a real model.

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

`node --experimental-strip-types --test tests/voice/*.test.ts` covers the number check, source markers, sentence splitting,
the grounding check (including a 200-claim synthetic set: 10 made-up cases, 3 providers each) and, with a dev server and
the stand-in endpoint configured as described in `agent-network.test.ts`, the network cases.
