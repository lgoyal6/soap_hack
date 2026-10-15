# Provider portal (owner: Laksh)

Each treating provider gets its own login and sees only what the attorney published to it.

## Flow

1. Firm page, "Share with providers" (`components/share/SharePanel.tsx`): a consent grid of provider x category
   (stage, requests, own bills, coverage, other treaters). Coverage is off by default; every category starts without consent.
2. "Preview as this provider" shows exactly what Publish would send. "Held back" lists the categories without consent.
3. Publish (`POST /api/share/publish`) snapshots each consented category from `getShareable` into `shared_items`.
   A category without consent is refused with 403 and nothing is written. The panel sends back the revision of each
   category it previewed; if the case changed since, or a previewed category lost consent, the publish is refused
   (409 or 403) and nothing is written. See "Publishing contract" below.
4. "Generate access code" creates the provider login: the provider's email from Clio plus a 10-character code,
   shown once and stored only as a salted scrypt hash (`lib/portal/codes.ts`). "Revoke access" ends it at once.
5. The provider signs in at `/login`, sees every patient the practice has with the firm (`/provider`) and what moved
   since the last login, opens a case (`/provider/case/<id>`) and answers each request with one click:
   "Sending by [date]", "Waiting on the patient", "Unpaid balance is holding this up", "Not proceeding".
6. Replies go to `provider_replies`; the firm page's open items read them (contract E) and refresh every few seconds.
7. Lien: provider confirms its balance, firm asks for a reduction, provider accepts or counters, firm can accept the
   counter. Every step is kept in `liens.history` (`lib/portal/lien.ts`).
8. Every provider open is written to `view_log`; the firm sees "opened N times, last ..." per provider.
9. On a stage change (or a stage/status containing "settle"), each provider with an active login gets an `outbox`
   row. The email names the new stage only if that provider has stage consent. Nothing is ever sent.

## Rules enforced in code

- The provider side reads only `shared_items` joined to active `consent`, plus its own replies and lien (`lib/portal/provider.ts`).
  Revoking consent hides that category immediately, even if it was published earlier.
- Access follows the user row, not the cookie: a provider sees the nodes whose Clio email matches its login.
- A provider can reply only to a request id that was published to it.
- Providers get 403 on `/api/share/*` and `/api/voice/*`, 401 on `/api/case/*`, and `/firm` redirects them to `/login`.
- Payloads carry labels and values only, never Clio record ids.

## Publishing contract (`lib/portal/publish.ts`, `db/03_publish_jobs.sql`)

- **One transaction, all or nothing.** Provider-on-case check, consent check, every category's write, the audit rows
  and the outbox row commit together. A failure part way leaves nothing behind.
- **Consent is locked, not just read.** The consent rows are read `FOR SHARE`. A revoke that committed first is seen and
  the publish is refused; a revoke that arrives during a publish waits for it to commit and then hides the item
  (the provider side joins on active consent).
- **Revision.** Each category's snapshot has a revision: sha256 of its canonical label and payload. The idempotency key is
  sha256 of case, provider, category and revision.
- **No duplicates.** `publish_heads` holds the latest revision per case, provider and category. A category is written only
  when its revision differs from the head, so a retry, a double click or eight concurrent clicks write one item, while
  content that changes and changes back (A, B, A) is published three times.
- **Ordering.** Items are stamped with `clock_timestamp()` after the head lock, so "latest" for the provider is the order
  the head moved in.
- **Stale preview.** `expected` revisions that no longer match the case give 409 with the stale categories.
- **Audit.** `publish_jobs` keeps one row per category per committed publish: `published` or `unchanged`, with the request id.
  Refusals roll back and are reported to the caller and in the log line.
- **Outbox.** One `outbox` row (reason `shared`) per publish that wrote something, only for a provider with an active
  login. Nothing is sent.
- **Not covered.** Snapshots come from `getShareable` just before the transaction, not from a locked source revision of
  the Clio sync; a sync that lands between the preview and the publish is caught only through the revision compare.
  Re-granting consent after a revoke shows the item published before the revoke again (unchanged from before).

## Operations

- **Start.** `docker compose up -d` loads `db/01_core.sql`, `02_portal_voice.sql` and `03_publish_jobs.sql` on a new volume
  (checked on Postgres 16 with a 2 GB / 2 CPU cap). An existing volume does not rerun them: apply `03_publish_jobs.sql`
  by hand once (`docker compose exec -T db psql -U casebrief < db/03_publish_jobs.sql`).
- **Health.** `GET /api/health` returns `{"status":"ok","check":"liveness"}` with `Cache-Control: no-store`.
  It proves HTTP serving only and does not query case data, sessions, the database or a provider. Check database
  readiness separately with the compose healthcheck (`pg_isready`); a healthy app probe does not establish that
  publishing is available. `GET /login` remains a page smoke check.
- **Correlation.** Every publish answers with an `x-request-id` header (the caller's, if it looks safe, otherwise a new
  UUID) and logs one JSON line `{"evt":"share.publish", requestId, matterId, providerNodeId, ms, status, published, unchanged}`:
  ids and counts only, never payloads, names or emails. The same id is on the `shared_items` and `publish_jobs` rows.
- **Recovery.** A publish that failed or whose answer was lost can simply be repeated: nothing partial was kept, and a
  repeat of a committed publish is `unchanged`.
- **Rollback.** The `DROP`/`ALTER` lines at the top of `db/03_publish_jobs.sql` remove what it added. Rows written by the
  new code stay readable by the old code (the extra columns are ignored); the old code would again write a duplicate
  item per click.
- **Retention.** `publish_jobs` and `outbox` grow by one row per category per publish. Nothing prunes them yet; they are
  deleted with the provider node (cascade).

## Test

```bash
npm run dev       # in another terminal
node --env-file=.env --experimental-strip-types --test tests/portal/*.test.ts
```

`tests/portal/access.test.ts` builds its own made-up matter with two providers, checks sign-in, every firm route,
cross-provider reads and writes, forged and unsigned cookies, publishing without consent, and revocation, then cleans up.
It skips itself if the server or database is not reachable.

`tests/portal/publish-race.test.ts` needs no server: it makes a throwaway database on the Postgres you name, loads
`db/*.sql` and drops it afterwards.

```bash
TEST_DATABASE_URL=postgres://casebrief:casebrief@127.0.0.1:5433/postgres \
  node --experimental-strip-types --test tests/portal/publish-race.test.ts
```

It covers revoke before and during a publish, repeats, concurrent publishes of one and of different snapshots, a stale
preview, a failure after the first write, a retry after a lost answer, a forged or cross-case provider, no consent,
provider read isolation and the outbox. Where it matters, the old publish path (`tests/portal/baseline-publish.ts`)
runs on the same trigger to show the check can fail.

### Rendered sharing controls

`tests/portal/share-panel.browser.cjs` uses Chromium to check keyboard consent
changes, revision-bound publishing, stale-publish feedback, failed-load recovery
and the empty-provider state. It replaces share API responses with synthetic
fixtures while rendering the actual firm page. It checks accessibility roles and
keyboard activation; it does not replace a session with a screen-reader user.

Start the app in one terminal with fixtures and disabled external endpoints:

```bash
USE_FIXTURES=1 SESSION_SECRET=casebrief-local-browser-fixture \
DATABASE_URL=postgres://disabled:disabled@127.0.0.1:1/disabled \
CLIO_BASE_URL=http://127.0.0.1:1 GMI_BASE_URL=http://127.0.0.1:1/v1 \
GMI_API_KEY=local-disabled-fixture NEXT_TELEMETRY_DISABLED=1 \
  npm run dev -- --webpack --hostname 127.0.0.1 --port 3317
```

Install the browser driver outside the repository and run the checks in another
terminal. This leaves the shared package and lockfile unchanged:

```bash
browser_tools="$(mktemp -d)"
npm install --prefix "$browser_tools" --no-package-lock --no-save playwright@1.62.1
"$browser_tools/node_modules/.bin/playwright" install chromium
NODE_PATH="$browser_tools/node_modules" BASE_URL=http://127.0.0.1:3317 \
SESSION_SECRET=casebrief-local-browser-fixture \
  node --test tests/portal/share-panel.browser.cjs
```

Stop the fixture server after testing. The browser closes its isolated contexts
and process after the suite; no real provider, Clio or model request is required.
