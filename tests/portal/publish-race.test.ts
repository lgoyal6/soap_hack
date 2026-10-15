// Owner: Laksh. Publishing under races, retries and partial failure, against a real disposable Postgres.
//   TEST_DATABASE_URL=postgres://casebrief:casebrief@127.0.0.1:5433/postgres \
//     node --experimental-strip-types --test tests/portal/publish-race.test.ts
// Each failure case has a named oracle (the database rows), a trigger, and where it matters the old publish path
// (tests/portal/baseline-publish.ts) run on the same trigger, to show the check can fail.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ShareCategory } from "../../lib/contracts.ts";
import { hashCode } from "../../lib/portal/codes.ts";
import { PROVIDER_ITEMS_SQL, publishSnapshot, revisionOf, ShareError, type Snapshot } from "../../lib/portal/publish.ts";
import { baselinePublish } from "./baseline-publish.ts";
import { gate, makeTestDb, until, type TestDb } from "./pgtest.ts";

let t: TestDb | null = null;
before(async () => { t = await makeTestDb(); });
after(async () => { await t?.drop(); });
const need = (tc: { skip: (m: string) => void }) => { if (!t) { tc.skip("TEST_DATABASE_URL not set"); return false; } return true; };

let seq = 0;
const snaps = (tag = "v1"): Record<ShareCategory, Snapshot> => ({
  stage: { label: "Case stage", payload: { stage: `Treatment ${tag}`, status: "Open" } },
  requests: { label: "What the firm needs", payload: [{ id: "open-file", what: `Therapy file ${tag}` }] },
  own_bills: { label: "Their own bills", payload: [{ amount: 1200, tag }] },
  coverage: { label: "Insurance coverage", payload: { limit: "100,000 per person", tag } },
  other_treaters: { label: "Other treating providers", payload: [] },
});

/** A made-up case with providers, logins and consent. Each call uses fresh ids, so tests do not interfere. */
async function seedCase(providers = 2, consent: ShareCategory[] = ["stage", "requests"]) {
  const db = t!.pool;
  const matterId = 800_000 + ++seq;
  const nodes: number[] = [];
  for (let i = 0; i < providers; i++) {
    const email = `p${i}-${matterId}@race.test`;
    const [n] = (await db.query("INSERT INTO nodes (matter_id, type, name, norm_name, props) VALUES ($1,'provider',$2,$3,$4) RETURNING id",
      [matterId, `Practice ${i}`, `practice ${i} ${matterId}`, JSON.stringify({ email })])).rows;
    const id = Number(n.id);
    nodes.push(id);
    const [u] = (await db.query("INSERT INTO users (role, email, provider_node_id) VALUES ('provider',$1,$2) RETURNING id", [email, id])).rows;
    await db.query("INSERT INTO access_codes (user_id, code_hash) VALUES ($1,$2)", [u.id, hashCode("AAAAA-AAAAA")]);
    for (const c of consent) await db.query("INSERT INTO consent (provider_node_id, category) VALUES ($1,$2)", [id, c]);
  }
  const [f] = (await db.query("INSERT INTO users (role, email) VALUES ('firm',$1) RETURNING id", [`firm-${matterId}@race.test`])).rows;
  return { matterId, nodes, firmUser: Number(f.id) };
}

const input = (c: { matterId: number; firmUser: number }, nodeId: number, extra: Partial<Parameters<typeof publishSnapshot>[1]> = {}) => ({
  matterId: c.matterId, nodeId, userId: c.firmUser, requestId: `req-${++seq}-abcdefgh`, patient: "Test Patient", snapshots: snaps(), ...extra,
});
const count = async (sql: string, params: unknown[]) => Number((await t!.pool.query(sql, params)).rows[0].n);
const items = (matterId: number, nodeId: number, cat?: string) =>
  count(`SELECT count(*) AS n FROM shared_items WHERE matter_id = $1 AND provider_node_id = $2 ${cat ? "AND category = $3" : ""}`, cat ? [matterId, nodeId, cat] : [matterId, nodeId]);
const visible = async (nodeIds: number[], matterId: number) => (await t!.pool.query(PROVIDER_ITEMS_SQL, [nodeIds, matterId])).rows;
const revokeSql = "UPDATE consent SET revoked_at = now() WHERE provider_node_id = $1 AND category = $2 AND revoked_at IS NULL";
async function refused(p: Promise<unknown>, status: number) {
  try { await p; } catch (e) { assert.ok(e instanceof ShareError, String(e)); assert.equal(e.status, status); return e; }
  assert.fail(`expected ${status}, publish succeeded`);
}

test("consent revoked between preview and commit: refused, nothing written", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1);
  const expected = { stage: revisionOf(snaps().stage), requests: revisionOf(snaps().requests) }; // the preview
  await t!.pool.query(revokeSql, [c.nodes[0], "requests"]);
  const e = await refused(publishSnapshot(t!.pool, input(c, c.nodes[0], { expected })), 403);
  assert.deepEqual(e.extra.refused, ["requests"]);
  assert.equal(await items(c.matterId, c.nodes[0]), 0);
  assert.equal(await count("SELECT count(*) AS n FROM publish_jobs WHERE matter_id = $1", [c.matterId]), 0);
  // Valid control: the remaining consented category alone publishes.
  const r = await publishSnapshot(t!.pool, input(c, c.nodes[0], { categories: ["stage"], expected }));
  assert.deepEqual(r.published, ["stage"]);
});

test("consent revoked while a publish is in flight: the revoke waits for the commit, then hides it (old path: revoke slips in)", async (tc) => {
  if (!need(tc)) return;
  // New path.
  const c = await seedCase(1);
  const g = gate();
  let checked = false;
  const pub = publishSnapshot(t!.pool, input(c, c.nodes[0]), { afterConsentCheck: async () => { checked = true; await g.wait(); } });
  assert.ok(await until(async () => checked));
  let revokeDone = false;
  const revoke = t!.pool.query(revokeSql, [c.nodes[0], "requests"]).then(() => { revokeDone = true; });
  // Oracle: Postgres reports the revoke waiting on a lock held by the publish transaction.
  assert.ok(await until(async () => (await count(
    "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE consent%'", [])) === 1));
  assert.equal(revokeDone, false);
  g.open();
  const r = await pub;
  await revoke;
  assert.deepEqual(r.published, ["stage", "requests"]);
  // After the revoke committed, the provider no longer sees requests; stage stays visible.
  assert.deepEqual((await visible(c.nodes, c.matterId)).map((x) => x.category), ["stage"]);

  // Old path on the same trigger: the revoke commits while the publish is between its check and its insert,
  // and the publish then writes anyway. This is the failure the lock removes.
  const b = await seedCase(1);
  const g2 = gate();
  let checked2 = false;
  const old = baselinePublish(t!.pool, { ...input(b, b.nodes[0]) }, { afterConsentCheck: async () => { checked2 = true; await g2.wait(); } });
  assert.ok(await until(async () => checked2));
  let oldRevokeDone = false;
  await t!.pool.query(revokeSql, [b.nodes[0], "requests"]).then(() => { oldRevokeDone = true; });
  assert.equal(oldRevokeDone, true, "with no lock the revoke commits immediately");
  g2.open();
  await old;
  const after = await count("SELECT count(*) AS n FROM shared_items s JOIN consent c ON c.provider_node_id = s.provider_node_id AND c.category = s.category WHERE s.provider_node_id = $1 AND s.published_at > c.revoked_at", [b.nodes[0]]);
  // published_at is the insert's transaction time, which in the old path is after the revoke.
  assert.equal(after, 1, "old path wrote a requests item after consent was revoked");
});

test("repeated publication writes one item (old path: one per click)", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1);
  const a = await publishSnapshot(t!.pool, input(c, c.nodes[0]));
  const b = await publishSnapshot(t!.pool, input(c, c.nodes[0]));
  assert.deepEqual(a.published, ["stage", "requests"]);
  assert.deepEqual(b.published, []);
  assert.deepEqual(b.unchanged, ["stage", "requests"]);
  assert.equal(await items(c.matterId, c.nodes[0]), 2);
  assert.deepEqual((await t!.pool.query("SELECT outcome, count(*)::int AS n FROM publish_jobs WHERE matter_id = $1 GROUP BY outcome ORDER BY outcome", [c.matterId])).rows,
    [{ outcome: "published", n: 2 }, { outcome: "unchanged", n: 2 }]);
  assert.equal(await count("SELECT count(*) AS n FROM outbox WHERE matter_id = $1 AND reason = 'shared'", [c.matterId]), 1);

  const o = await seedCase(1);
  await baselinePublish(t!.pool, input(o, o.nodes[0]));
  await baselinePublish(t!.pool, input(o, o.nodes[0]));
  assert.equal(await items(o.matterId, o.nodes[0]), 4, "old path duplicates every category");
});

test("eight concurrent publishes of one snapshot write one item per category (old path: eight)", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1);
  const rs = await Promise.all(Array.from({ length: 8 }, () => publishSnapshot(t!.pool, input(c, c.nodes[0]))));
  assert.equal(rs.filter((r) => r.published.length === 2).length, 1);
  assert.equal(rs.filter((r) => r.unchanged.length === 2).length, 7);
  assert.equal(await items(c.matterId, c.nodes[0]), 2);

  const o = await seedCase(1);
  await Promise.all(Array.from({ length: 8 }, () => baselinePublish(t!.pool, input(o, o.nodes[0]))));
  assert.equal(await items(o.matterId, o.nodes[0]), 16);
});

test("concurrent publishes of different snapshots: each written once, head points at the newest", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1, ["stage"]);
  const tags = ["a", "b", "c", "d"];
  await Promise.all(tags.map((tag) => publishSnapshot(t!.pool, input(c, c.nodes[0], { snapshots: snaps(tag) }))));
  assert.equal(await items(c.matterId, c.nodes[0], "stage"), 4);
  const [head] = (await t!.pool.query("SELECT h.source_revision, s.source_revision AS item_rev, s.id FROM publish_heads h JOIN shared_items s ON s.id = h.shared_item_id WHERE h.provider_node_id = $1", [c.nodes[0]])).rows;
  const [newest] = (await visible(c.nodes, c.matterId));
  assert.equal(head.source_revision, head.item_rev);
  assert.equal(Number(head.id), Number(newest.id), "provider sees the item the head points at");
});

test("content changed and changed back: a new item each time (A, B, A is three publications)", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1, ["stage"]);
  for (const tag of ["a", "b", "a"]) await publishSnapshot(t!.pool, input(c, c.nodes[0], { snapshots: snaps(tag) }));
  assert.equal(await items(c.matterId, c.nodes[0]), 3);
  assert.equal((await visible(c.nodes, c.matterId))[0].payload.stage, "Treatment a");
});

test("stale preview: the case moved on, publish refused with 409 and nothing written; a fresh preview publishes", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1);
  const expected = { stage: revisionOf(snaps("v1").stage), requests: revisionOf(snaps("v1").requests) };
  const e = await refused(publishSnapshot(t!.pool, input(c, c.nodes[0], { expected, snapshots: snaps("v2") })), 409);
  assert.deepEqual(e.extra.stale, ["stage", "requests"]);
  assert.equal(await items(c.matterId, c.nodes[0]), 0);
  const fresh = { stage: revisionOf(snaps("v2").stage), requests: revisionOf(snaps("v2").requests) };
  assert.deepEqual((await publishSnapshot(t!.pool, input(c, c.nodes[0], { expected: fresh, snapshots: snaps("v2") }))).published, ["stage", "requests"]);
});

test("failure after the first category is written: nothing is kept; the retry writes each category once", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1);
  await assert.rejects(publishSnapshot(t!.pool, input(c, c.nodes[0]), { afterInsert: async (cat) => { if (cat === "stage") throw new Error("connection lost"); } }), /connection lost/);
  assert.equal(await items(c.matterId, c.nodes[0]), 0);
  assert.equal(await count("SELECT count(*) AS n FROM publish_heads WHERE provider_node_id = $1", [c.nodes[0]]), 0);
  assert.equal(await count("SELECT count(*) AS n FROM outbox WHERE matter_id = $1", [c.matterId]), 0);
  const r = await publishSnapshot(t!.pool, input(c, c.nodes[0]));
  assert.deepEqual(r.published, ["stage", "requests"]);
  assert.equal(await items(c.matterId, c.nodes[0]), 2);
});

test("retry after the response was lost: committed once, the retry is 'unchanged' and adds no outbox row", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1);
  const first = input(c, c.nodes[0]);
  await publishSnapshot(t!.pool, first); // committed; pretend the client never saw the answer
  const retry = await publishSnapshot(t!.pool, { ...first, requestId: first.requestId });
  assert.deepEqual(retry.published, []);
  assert.equal(await items(c.matterId, c.nodes[0]), 2);
  assert.equal(await count("SELECT count(*) AS n FROM outbox WHERE matter_id = $1", [c.matterId]), 1);
  assert.equal(await count("SELECT count(*) AS n FROM publish_jobs WHERE request_id = $1", [first.requestId]), 4);
});

test("forged or cross-case provider: refused with 404 and nothing written", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1);
  const other = await seedCase(1);
  // Provider of another case, named on this case.
  await refused(publishSnapshot(t!.pool, input(c, other.nodes[0])), 404);
  // A node on this case that is not a provider.
  const [p] = (await t!.pool.query("INSERT INTO nodes (matter_id, type, name, norm_name) VALUES ($1,'person','Client',$2) RETURNING id", [c.matterId, `client ${c.matterId}`])).rows;
  await refused(publishSnapshot(t!.pool, input(c, Number(p.id))), 404);
  assert.equal(await count("SELECT count(*) AS n FROM shared_items WHERE matter_id = $1 OR provider_node_id = $2", [c.matterId, other.nodes[0]]), 0);
});

test("no consent: refused with the category named; consented categories publish", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(1);
  const e = await refused(publishSnapshot(t!.pool, input(c, c.nodes[0], { categories: ["coverage", "stage"] })), 403);
  assert.deepEqual(e.extra.refused, ["coverage"]);
  assert.equal(await items(c.matterId, c.nodes[0]), 0, "all or nothing: stage was not written either");
  await refused(publishSnapshot(t!.pool, input(c, c.nodes[0], { categories: ["bogus" as ShareCategory] })), 400);
});

test("provider reads: own items only, revoked category hidden, another provider's items never returned", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(2);
  await publishSnapshot(t!.pool, input(c, c.nodes[0]));
  await publishSnapshot(t!.pool, input(c, c.nodes[1], { snapshots: snaps("for-b") }));
  const a = await visible([c.nodes[0]], c.matterId);
  assert.deepEqual(a.map((x) => Number(x.provider_node_id)), [c.nodes[0], c.nodes[0]]);
  assert.ok(a.every((x) => !JSON.stringify(x.payload).includes("for-b")));
  await t!.pool.query(revokeSql, [c.nodes[0], "stage"]);
  assert.deepEqual((await visible([c.nodes[0]], c.matterId)).map((x) => x.category), ["requests"]);
  assert.equal((await visible([c.nodes[1]], c.matterId)).length, 2, "B unaffected by A's revoke");
});

test("outbox: one row per publish that wrote something, only for a provider with an active login", async (tc) => {
  if (!need(tc)) return;
  const c = await seedCase(2);
  await t!.pool.query("UPDATE access_codes SET revoked_at = now() WHERE user_id = (SELECT id FROM users WHERE provider_node_id = $1)", [c.nodes[1]]);
  await publishSnapshot(t!.pool, input(c, c.nodes[0]));
  await publishSnapshot(t!.pool, input(c, c.nodes[1]));
  const rows = (await t!.pool.query("SELECT recipient FROM outbox WHERE matter_id = $1 AND reason = 'shared'", [c.matterId])).rows;
  assert.deepEqual(rows.map((r) => r.recipient), [`p0-${c.matterId}@race.test`]);
});
