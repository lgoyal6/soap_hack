# Build plan: Tijil and Laksh

What to build is specified in `HANDOFF.md` (sections 6 to 10). This file says **who builds what, in which files, and in what order**.
It replaces section 11 of `HANDOFF.md`.

Repo: https://github.com/lgoyal6/soap_hack

## The split

| | Tijil | Laksh |
|---|---|---|
| Session 1 | **Pipeline**: Clio sync, facts, computed sections, conflicts, case graph, search, scan job | **Provider portal**: logins, share panel, consent, replies, lien, practice home |
| Session 2 | **Firm screens**: firm page, source panel, top ten and ranker, replay | **Voice agent**: tool loop, sentence check, speech, page control, drafts |

## Rule 1: every file has exactly one owner

Edit only your own paths. If you need a change in the other person's file, ask them; do not edit it.

| Path | Owner |
|---|---|
| `db/01_core.sql` | Tijil |
| `lib/db.ts`, `lib/llm.ts`, `lib/contracts.ts` | Tijil (frozen after the foundation step) |
| `lib/clio.ts`, `lib/sync.ts`, `lib/pipeline/**`, `lib/tools/**` | Tijil |
| `app/api/clio/**`, `app/api/sync/**`, `app/api/case/**`, `app/api/scan/**` | Tijil |
| `app/firm/**`, `components/firm/**` | Tijil |
| `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | Tijil |
| `package.json`, `package-lock.json`, `docker-compose.yml`, `.env.example`, `.gitignore`, config files | Tijil |
| `README.md`, `docs/pipeline.md`, `docs/firm.md`, `docs/submission.md` | Tijil |
| `fixtures/**`, `tests/pipeline/**` | Tijil |
| `db/02_portal_voice.sql` | Laksh |
| `lib/session.ts` | Laksh (working version supplied in the foundation step) |
| `lib/portal/**`, `lib/voice/**` | Laksh |
| `app/provider/**`, `app/login/**` | Laksh |
| `app/api/auth/**`, `app/api/provider/**`, `app/api/share/**`, `app/api/voice/**` | Laksh |
| `components/provider/**`, `components/share/**`, `components/voice/**` | Laksh |
| `docs/portal.md`, `docs/voice.md` | Laksh |
| `tests/portal/**`, `tests/voice/**` | Laksh |
| `handoffs/tijil-*.md` / `handoffs/laksh-*.md` | each their own |

Within one laptop, the two sessions also stay apart: Tijil's pipeline session never edits `app/firm/**` or
`components/firm/**`; Laksh's portal session never edits `lib/voice/**`, `app/api/voice/**` or `components/voice/**`.

**New packages:** only Tijil installs. Everything known to be needed is installed in the foundation step. Laksh asks if something is missing.

**Database:** two schema files so nobody shares one. Postgres applies them only on first start. To add a table later,
edit your own file and run `docker compose down -v && docker compose up -d`, then re-sync. Tell the other person first.

## Rule 2: the lanes meet only at these contracts

All of these are defined in `lib/contracts.ts` in the foundation step and then frozen.

**A. Case tools** (Tijil implements in `lib/tools/index.ts`; Laksh's voice and share code call them).
At first they return data from a made-up fixture case, so Laksh can build immediately. Tijil later swaps the insides
for real data without changing the signatures.

```ts
type SourceRef = { resource: string; clioId: number; pageNo?: number; quote?: string };
type ToolResult<T> = { data: T; sources: SourceRef[]; searched: { records: number; pages: number } };

listMatters()
listProviders(matterId)                      // providers on the matter, from the case graph
getSummary(matterId)
getOpenItems(matterId)
getConflicts(matterId)
getMoney(matterId)
getNotDone(matterId)
getChanges(matterId, since)
searchRecords(matterId, query)
getRelated(matterId, entity)
getRecord(ref: SourceRef)
getTimeline(matterId)                        // feeds the replay
getShareable(matterId, providerNodeId)       // per category: what could be shared with this provider
```

**B. Session** (Laksh owns `lib/session.ts`; Tijil's Clio callback and firm layout call it).

```ts
createSession(user: { id: number; role: "firm" | "provider"; providerNodeId?: number })
getSession()            // null if not signed in
requireRole(role)       // redirects to /login if the role doesn't match
destroySession()
```

`app/firm/layout.tsx` (Tijil) calls `requireRole("firm")`. `app/provider/layout.tsx` (Laksh) calls `requireRole("provider")`.
No middleware file.

**C. Voice moves the page** through browser events. Laksh's voice code dispatches them; Tijil's firm page listens.

```ts
window.dispatchEvent(new CustomEvent("casebrief:show",   { detail: { section?: string, source?: SourceRef } }))
window.dispatchEvent(new CustomEvent("casebrief:chips",  { detail: { sources: SourceRef[] } }))
window.dispatchEvent(new CustomEvent("casebrief:replay", { detail: { from?: string, to?: string } }))
```

**D. Two components Laksh owns are mounted on Tijil's firm page.** The foundation step creates one-line stubs; after that only Laksh edits them.

```tsx
<VoiceDock matterId={id} />     // components/voice/VoiceDock.tsx
<SharePanel matterId={id} />    // components/share/SharePanel.tsx
```

**E. Provider replies reach the firm page through the database.** Laksh writes rows to `provider_replies` and `liens`.
Tijil's `getOpenItems` reads them. Neither calls the other's code.

**F. Model calls** go through `lib/llm.ts` (Tijil, frozen), which logs tokens and duration to `llm_calls`. Both use it.

## Foundation step

**Tijil's session does this alone, pushes, and only then does Laksh clone.**

1. Scaffold the Next.js app into the repo. (If npm times out on the venue wifi, use a phone hotspot.)
2. Install every package now: `pg`, `openai`, `pdf-lib`.
3. Split the schema into `db/01_core.sql` (sync, facts, graph, search, sections, ranker, cost log, firm visits)
   and `db/02_portal_voice.sql` (users, access codes, consent, shared items, replies, liens, view log, drafts, outbox, voice turns).
4. Write `lib/db.ts`, `lib/llm.ts`, `lib/contracts.ts`, a working `lib/session.ts`, and `lib/tools/index.ts` backed by a made-up fixture case.
5. Create the stubs: `VoiceDock`, `SharePanel`, `app/firm/layout.tsx`, `app/provider/layout.tsx`, `app/login/page.tsx`, empty `docs/*.md`.
6. `.gitignore` includes `.env`, `node_modules`, `graphify-out/`.
7. Push to the repo and tell Laksh.

**Meanwhile, Laksh (no repo needed):**
- Start Docker Desktop.
- With the GMI key: list the models, pick `LLM_MODEL` and `LLM_MODEL_FAST`, send one test request with a tool attached, and check whether a text-to-speech model is callable. Send Tijil the model IDs.

**Meanwhile, Tijil (the person):**
- Create the Clio developer app (redirect `http://localhost:3000/api/clio/callback`, read-only scopes) and put the ID and secret in `.env`.
- Generate `SESSION_SECRET`.

## The four lanes

Each lane is a list of steps in order. Specs are in `HANDOFF.md`; the section number is in brackets.

### Tijil, session 1: pipeline

| Step | Build | Done when |
|---|---|---|
| 1 | Clio sign-in, GET-only client, sync all resources into `raw_records` with backoff [4, 7.1] | Sync runs on the real account; row counts shown per resource |
| 2 | Tag communications, extract facts with quotes, compute open items, money, dates, last contact. Swap tools from fixtures to real data. Start the scan job [7.2-7.4, 7.8] | `getOpenItems` and `getMoney` return real data with sources |
| 3 | Conflicts, not yet done, case graph, search (keyword; embeddings if a key exists) [7.5-7.7] | `getConflicts`, `getNotDone`, `getRelated`, `searchRecords` return real data |
| 4 | Recent changes, timeline for replay, shareable payloads, cost totals [7.10] | Every tool in contract A is real; cost per case can be read from `llm_calls` |

### Tijil, session 2: firm screens

| Step | Build | Done when |
|---|---|---|
| 1 | Firm page with all eight sections on fixture data, large type [9] | Page renders every section from the tools |
| 2 | Source side panel with the quote highlighted; listen for the three page events [6.3, contract C] | Clicking any line opens its source; a test event scrolls the page |
| 3 | Top ten with pin and dismiss, feedback log, weight refit [7.9] | Pinning changes the order after refit |
| 4 | Replay animation from `getTimeline` [9] | Plays start to finish on real data; responds to the replay event |

### Laksh, session 1: provider portal

| Step | Build | Done when |
|---|---|---|
| 1 | Login page, provider login by email plus access code, role check, sign-out [10] | A provider session gets sent away from `/firm` |
| 2 | Share panel: consent grid, preview as provider, held-back list, publish, access code generate and revoke [10] | Publishing writes `shared_items`; publishing without consent is refused |
| 3 | Provider case view, one-click replies, balance field, lien request and response, view log [10] | A reply appears in `provider_replies`; firm sees the open in `view_log` |
| 4 | Practice home, outbox entries on stage change, access test [10] | Test passes: provider gets 403 on firm routes and on another provider's data |

### Laksh, session 2: voice agent

| Step | Build | Done when |
|---|---|---|
| 1 | Tool-calling loop over contract A with typed input, streaming, conversation history [8] | Typed questions get answers built from tool results |
| 2 | Sentence check (numbers only from tools), source chips, page events [6.1, 8, contract C] | A sentence with an unsourced number is dropped and logged; the page scrolls as it answers |
| 3 | Speech in (Chrome, hold space), speech out, interrupt, drafts [8] | Spoken question gets a spoken answer; space stops it; a draft is saved |
| 4 | Opening brief, replay control, latency and token log [8] | "Brief me" works end to end; `voice_turns` has timings |

## Checkpoints (both stop and check together)

1. Laksh has cloned; `docker compose up -d` and `npm run dev` work on both laptops.
2. Real sync done on Tijil's laptop.
3. Tools return real data; voice answers a typed question from the real case.
4. Laksh's provider reply shows on Tijil's firm page; voice moves the page.
5. Feature freeze: no new features after this.

## If something has to go, drop in this order

1. Body regions in the replay
2. Ranker refit (keep the top ten and pins)
3. Lien counter-offers (keep balance and request)
4. Practice home
5. Embeddings (keep keyword search)

Whatever is dropped goes in `docs/submission.md` as unfinished.

## Before submitting

| Who | Task |
|---|---|
| Laksh | Fresh clone into a new folder, follow the README exactly, report anything that breaks |
| Tijil | Record the 90-second video on Sapini; upload to Google Drive with public access |
| Tijil | Finish `README.md` and `docs/submission.md`: stack, models (via GMI Cloud), measured cost per case, what is unfinished |
| Laksh | Finish `docs/portal.md` and `docs/voice.md`; record a fallback clip of the voice part |
| Both | Submit the form |

## Working rules

- **Git:** one branch, `main`. Commit small. Stage only your own paths (`git add <path>`, never `git add -A`). `git pull --rebase` before every push.
- **Graphify:** `graphify-out/` is ignored by git, so each laptop keeps its own. Run `graphify update .` after each commit, and use `graphify query "<question>"` to find code before opening files.
- **Nothing from the case in code or prompts.** No names, dates, amounts or IDs. The fixture case is made up.
- **GET only against Clio.**
- **Session handoff at 90%:** write `handoffs/<name>-<lane>.md` as in `HANDOFF.md` section 14, commit and push.
