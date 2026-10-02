# Provider portal (owner: Laksh)

Each treating provider gets its own login and sees only what the attorney published to it.

## Flow

1. Firm page, "Share with providers" (`components/share/SharePanel.tsx`): a consent grid of provider x category
   (stage, requests, own bills, coverage, other treaters). Coverage is off by default; every category starts without consent.
2. "Preview as this provider" shows exactly what Publish would send. "Held back" lists the categories without consent.
3. Publish (`POST /api/share/publish`) snapshots each consented category from `getShareable` into `shared_items`.
   A category without consent is refused with 403 and nothing is written.
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

## Test

```bash
npm run dev       # in another terminal
node --env-file=.env --experimental-strip-types --test tests/portal/*.test.ts
```

`tests/portal/access.test.ts` builds its own made-up matter with two providers, checks sign-in, every firm route,
cross-provider reads and writes, forged and unsigned cookies, publishing without consent, and revocation, then cleans up.
It skips itself if the server or database is not reachable.
