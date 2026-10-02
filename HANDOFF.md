# Casebrief: build handoff for today

Written 11:56 AM, Oct 2 2026. **Hard deadline 4:00 PM. Feature freeze 3:15 PM.**
For any coding agent or person picking this up. Self-contained. It replaces `casebrief_handoff.md` and `PLAN.md` for today's build.

## 1. What we are building

A web app that reads one personal-injury case live from Clio Manage and gives:

- **the law firm** a one-page brief, a voice paralegal that answers from the case and moves the page, and an animated replay of the case;
- **each treating medical provider** a separate portal with its own login, showing only what the attorney shared, where the provider answers the firm's requests with one click.

Team: two people, each running two coding sessions. Four lanes: pipeline, firm screens, provider portal, voice.

## 2. Event rules (breaking any of these loses)

- Works on the "Sapini" matter, read live from our Clio Manage account.
- **Clio is read-only.** Only GET requests. Our own data goes in our own database.
- **Nothing hardcoded.** No names, dates, amounts, IDs or page numbers from the case in code or prompts. Organisers read the repo.
- Both halves required: firm and providers.
- The page must stand on its own without the voice. Organisers said the product is a visual digest, not a chat.
- Submit by 4:00 PM: GitHub repo, 90-second video on Sapini (Google Drive, public link), tech stack and where data lives, AI models and approximate cost per case, honest notes on anything unfinished or hardcoded. Submission order is presentation order.

## 3. Stack

- **App:** Next.js (App Router) with TypeScript. One app, two route groups: `/firm` and `/provider`.
- **Database:** Postgres with the pgvector image, started by `docker compose up`.
- **Models:** GMI Cloud through its OpenAI-style API. Use the `openai` npm package with `baseURL` set from env. Model IDs come from env, never from code.
- **Speech in:** Chrome's built-in speech recognition, push-to-talk. The demo must run in Chrome.
- **Speech out:** GMI's ElevenLabs model if it is callable with our key; otherwise the browser's built-in voice.
- **Search:** Postgres full-text. Add embeddings only if an embedding key is supplied; otherwise keyword-only.

### Environment (`.env`, never committed; commit `.env.example` with names only)

| Name | What for | Needed by |
|---|---|---|
| `CLIO_CLIENT_ID`, `CLIO_CLIENT_SECRET` | Reading the case. Clio developer app, redirect `http://127.0.0.1:3000/api/clio/callback`, read-only scopes | Now |
| `GMI_API_KEY` | All model calls | Now |
| `GMI_BASE_URL` | `https://api.gmi-serving.com/v1` | Now |
| `LLM_MODEL`, `LLM_MODEL_FAST` | Model IDs picked from GMI's `/models` list (prefer a Claude model for the main one) | Now |
| `TTS_MODEL` | Voice model ID from GMI, if available | 1:30 |
| `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL` | Optional. Semantic half of search | 1:30 |
| `SESSION_SECRET` | Signing logins. `openssl rand -hex 32` | 12:30 |
| `DATABASE_URL` | Set by docker compose | - |

**First 15 minutes, before writing features:** list GMI's models with the key, pick the model IDs, and send one test request that includes a tool definition. Tool calling through a reseller can differ by model. If it fails on the chosen model, pick another.

## 4. Clio API notes (taken from Clio's docs, not yet tested by us)

- Base `https://app.clio.com/api/v4`. OAuth at `/oauth/authorize` and `/oauth/token`. The redirect URI must match exactly; test localhost first.
- **Responses return only `id` and `etag` unless you pass `fields`.** Nested fields look like `custom_field_values{field_name,value}`.
- Use `limit=200` and follow `meta.paging.next`.
- About 50 requests a minute. On 429, wait for `Retry-After`.
- Document download returns a redirect; follow it.
- Resources to sync: matters (with custom field values and stage), contacts, relationships, notes, communications, tasks, calendar entries, activities (expenses), documents, folders. All accept `updated_since`.
- Put every Clio call in one client module that exposes GET only.

## 5. Database tables

| Table | Holds |
|---|---|
| `raw_records` | Every synced Clio record: resource, Clio ID, etag, record date, JSON |
| `facts` | One extracted fact: type, value, source record, verbatim quote, page, status |
| `comm_tags` | Per communication: counterparty, topic, whether it is a request, which earlier request it answers |
| `nodes`, `edges` | Case graph: people, providers, injuries, requests; each edge has a source record |
| `scan_pages` | Per page of a scanned document: hash, extracted JSON, status |
| `sections` | Cached output of each page section and the fact IDs it used |
| `search_index` | Text, full-text vector, optional embedding, per record and per scan page |
| `feedback`, `ranker_weights` | Pins and dismissals; current weights for the top ten |
| `users`, `access_codes` | Firm users (via Clio) and provider logins (email plus code) |
| `consent` | Provider x category, who granted it, when, revoked when |
| `shared_items` | What has been published to each provider. **The provider portal reads only this.** |
| `provider_replies`, `liens` | One-click replies; balance, reduction requests, history |
| `drafts`, `outbox` | Drafts from the voice agent; emails that would be sent |
| `view_log`, `llm_calls`, `voice_turns` | Provider opens; tokens and cost per call; latency per voice turn |

Agree this schema and the tool signatures in section 8 before the lanes split.

## 6. Trust rules (enforced in code)

1. **The model never writes numbers.** Counts, dates, money and durations are computed by code. Any model sentence containing a number (digits or number words) that is not in a tool result or computed value is dropped.
2. **Every statement has a verbatim quote from its source.** Match after normalising whitespace and case. If the quote isn't found, drop the statement.
3. **Three kinds of claim:** quoted (click opens the source at the quote), computed (click shows the formula and inputs), aggregated (click lists the records counted).
4. **Honest absence:** "not found in the N records and M pages read", using counts of what was actually read.
5. **Deadlines are never computed.** Show the firm's own task and calendar entry together, with source.
6. **Nothing reaches a provider until a person publishes it.**

## 7. Pipeline

1. **Sync** all resources into `raw_records`. Later runs fetch only changed records (etag or `updated_since`).
2. **Tag communications** with a fast model: counterparty, topic, request or reply. Cache per record.
3. **Extract facts** per record with quote and source. Cache per record hash.
4. **Compute in code:**
   - Open items: for each request thread, who the firm is waiting on, number of asks, days open. Where records give different counts, show both.
   - Money: value, coverage figures, bills total, liens, firm spend, and a rough net to client with the arithmetic shown. The fee percentage is a setting, labelled as an assumption.
   - Relative dates such as "date of incident + N days" are resolved from the incident date field.
   - Last client contact, overdue and upcoming tasks.
5. **Conflicts:** compare facts of the same type across sources (coverage limits, counts, dates, treatment frequency). Normalise first. Show both versions with source and date. Do not pick one.
6. **Not yet done:** something the file says exists or should happen, with no later record showing it happened. Show how long it has been open. Let staff dismiss items.
7. **Case graph:** nodes from Clio contacts and relationships plus extracted entities; merge names by normalised name and email domain.
8. **Scan job** (background, start by 1:30): split each large PDF into pages, one extraction call per page (provider, date, document type, diagnoses, charges), cached by page hash. The firm page shows "N of M pages read".
9. **Top ten:** score each record by weighted features (type, money mentioned, deadline nearness, recency, party). Pins and dismissals are logged; a refit step updates the weights.
10. **Recent changes:** diff against a date the user picks, using each record's own date. All Clio records were created today, so "updated since" will be empty.

### Things the real case will test (handle these generally; never put the values in code)

- A limitations date that has passed, with a task saying it was satisfied.
- Notes that contradict later notes on coverage.
- Emails with identical bodies; dedupe by body hash.
- Totals described as interim.
- Different counts of the same thing across a task, a calendar entry and a note.
- Tasks whose names begin "By medical provider:"; match the name to a contact loosely.
- Empty document folders.
- No client photo field; the photo is inside a document in the intake folder.
- Things the test case does **not** contain: a police report, umbrella or medical-payments coverage, paid or owed amounts, any lien other than one government lien. Panels for these must show "not found", not blanks.

## 8. Voice paralegal (firm portal only)

Flow: push-to-talk -> speech-to-text -> model with tools -> sentence check -> text-to-speech, streaming.

**Tools** (each returns data plus the record IDs behind it):

```
get_summary()
get_open_items()
get_conflicts()
get_money()
get_not_done()
get_changes(since)
search_records(query)
get_related(entity)
get_record(id)
show(target)            // a page section, or a record id plus a quote to highlight
play_replay(from, to)
create_draft(kind, to, body)
```

Must have:
- The model learns about the case only through tools.
- The sentence check from section 6 runs on each sentence before it is spoken.
- Source chips appear on screen as each sentence is spoken, and the page scrolls to the section.
- Hold space to talk; pressing space while it speaks stops it and aborts the request.
- Conversation history per session, so follow-up questions work.
- On open, it offers a 60-second brief and what changed.
- Drafts are saved in `drafts` with a copy button. Never sent, never written to Clio.
- A typed input box and captions use the same agent. Screeners will not have a microphone.
- Log time to first audio and tokens per turn in `voice_turns`.

## 9. Firm page (`/firm`)

One page, large text, no tabs. Every line opens its source in a side panel.

1. Top bar: client photo, stage, last client contact, limitations status, firm spend, pages read
2. Summary: two or three sentences on where the case stands and what the attorney must decide
3. Conflicts in the file
4. Money
5. Open items
6. Not yet done
7. Top ten entries, with pin and dismiss
8. Recent changes
9. Voice button, typed input, replay button, share panel

**Replay:** built from dated records and scan pages. Four lanes on a time axis (medical, legal, money, communications), a money bar against the coverage figure, open requests with a running count of asks, body regions from a keyword-to-region table in the repo. Same data always gives the same animation.

## 10. Provider portal (`/provider`)

- **Login:** the provider's email from Clio plus an access code the firm generates. No sign-up. The firm can revoke it.
- **Share panel (firm side):** consent grid of provider x category (stage, requests, own bills, coverage, other treaters). The attorney toggles categories, previews as the provider, sees what is being held back, and publishes. Coverage is off by default. The server refuses to publish a category without consent. Banner: "Assume defense counsel will read this."
- **Provider home:** every patient this practice has with the firm, and what moved since last login.
- **Case view:** open or closed and the stage; each request from the firm with one-click replies ("Sending by [date]", "Waiting on the patient", "Unpaid balance is holding this up", "Not proceeding"); a balance field.
- **Replies update the firm's open items immediately.**
- **Lien:** provider confirms balance; firm sends a reduction request; provider accepts or counters; history kept.
- **Emails** on stage change or settlement go to `outbox` (the test contacts have `.test` addresses).
- Firm sees every open in `view_log`.
- **Access test:** a provider session gets 403 on every `/firm` route and on another provider's data.

## 11. Lanes and times

**Superseded by `BUILD_PLAN.md`**, which assigns lanes to Tijil and Laksh, gives every file one owner, and has current times.

| Time | P1 session 1: pipeline | P1 session 2: firm screens | P2 session 1: provider portal | P2 session 2: voice |
|---|---|---|---|---|
| 12:00-12:20 | Repo, docker compose, schema | Agree schema and tool signatures | Agree schema and tool signatures | Test GMI model and tool calling |
| 12:20-1:00 | Clio login and sync | Firm page from mock JSON | Two logins and role check | Tool layer on fixtures, typed input loop |
| 1:00-1:45 | Tagging, facts, computed sections; start scan job | Live data, source panel | Share panel, consent grid | Sentence check, source chips, page control |
| 1:45-2:30 | Conflicts, not yet done, case graph, search | Top ten with pins, ranker refit | One-click replies, lien | Speech in and out, interrupt, drafts |
| 2:30-3:15 | Recent changes, token and cost log, backoff | Replay | Practice home, outbox, access test | Opening brief, replay control, latency log |
| 3:15-3:45 | Fresh-clone run, README | Record video | Check access test | Check typed input path |
| 3:45 | Submit | | | |

**If behind at 2:30, drop in this order:** body regions, ranker refit, lien counter-offers, practice home, embeddings.

## 12. Before submitting

- Fresh clone, `docker compose up`, sign in with Clio, sync, page loads. One command.
- `.env.example` present, `.env` not committed.
- README: what it is, how to run, architecture, "GET only against Clio" with a pointer to the client module, models used (via GMI Cloud), measured tokens and cost for one full digest and per voice minute, and a plain list of what is unfinished.
- Video: 90 seconds, on Sapini, public Drive link.
- Have a recorded fallback of the voice part; the room is loud.

## 13. Not built today (say so in the submission notes)

A check that a quote actually supports its claim, word-level highlights inside scans, a second test case, text messages, real email sending. The ranker learns from a few clicks on one case, so it shows the mechanism, not a trained model.

## 14. Session handoff rule

When a coding session reaches about 90% of its context or usage limit, stop feature work and write `handoffs/<lane>-<HHMM>.md`:

1. Lane and time
2. What is done and working, with file paths
3. What is half-done and what remains
4. The next three steps, in order
5. How to run and test it
6. Decisions made, and anything that differs from this document
7. Known bugs, stubs, anything temporarily hardcoded
8. Which env names it needs (never values)

Commit and push it with the work in progress. A new session reads this file first, then the latest handoff for its lane.
