// Owner: Laksh. Access test for the provider portal, run against a live dev server and its database.
//   npm run dev   (in another terminal), then:
//   node --env-file=.env --experimental-strip-types --test tests/portal/*.test.ts
// Skips itself when the server or database is not reachable. Uses its own made-up matter id and cleans up.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { hashCode } from "../../lib/portal/codes.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.SESSION_SECRET ?? "";
const MATTER = 990_001; // made up; no real matter uses it
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const cookie = (s: object) => {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `cb_session=${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
};
const get = (path: string, c: string) => fetch(BASE + path, { headers: { cookie: c }, redirect: "manual" });
const post = (path: string, c: string, body: object, method = "POST") =>
  fetch(BASE + path, { method, headers: { cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });

let ready = false;
let firm = "";
let provA = "";
const ids: Record<string, number> = {};

before(async () => {
  try {
    await fetch(BASE + "/login");
    await db.query("SELECT 1 FROM shared_items LIMIT 1");
    ready = !!SECRET;
  } catch { ready = false; }
  if (!ready) return;
  await cleanup();
  const node = async (name: string, email: string) =>
    Number((await db.query(
      "INSERT INTO nodes (matter_id, type, name, norm_name, props) VALUES ($1,'provider',$2,$3,$4) RETURNING id",
      [MATTER, name, name.toLowerCase(), JSON.stringify({ email })])).rows[0].id);
  ids.a = await node("Test Practice A", "a@access.test");
  ids.b = await node("Test Practice B", "b@access.test");
  const user = async (role: string, email: string, nodeId: number | null) =>
    Number((await db.query("INSERT INTO users (role, email, provider_node_id) VALUES ($1,$2,$3) RETURNING id", [role, email, nodeId])).rows[0].id);
  ids.firm = await user("firm", "firm@access.test", null);
  ids.ua = await user("provider", "a@access.test", ids.a);
  ids.ub = await user("provider", "b@access.test", ids.b);
  await db.query("INSERT INTO access_codes (user_id, code_hash) VALUES ($1,$2), ($3,$4)", [ids.ua, hashCode("AAAAA-AAAAA"), ids.ub, hashCode("BBBBB-BBBBB")]);
  for (const n of [ids.a, ids.b]) {
    await db.query("INSERT INTO consent (provider_node_id, category) VALUES ($1,'requests')", [n]);
    await db.query(
      "INSERT INTO shared_items (matter_id, provider_node_id, category, label, payload) VALUES ($1,$2,'requests','Requests',$3)",
      [MATTER, n, JSON.stringify([{ id: `open-test-${n}`, what: "Records" }])]);
  }
  firm = cookie({ userId: ids.firm, role: "firm" });
  provA = cookie({ userId: ids.ua, role: "provider", providerNodeId: ids.a });
});

async function cleanup() {
  await db.query("DELETE FROM view_log WHERE matter_id = $1", [MATTER]);
  await db.query("DELETE FROM liens WHERE matter_id = $1", [MATTER]);
  await db.query("DELETE FROM users WHERE email LIKE '%@access.test'"); // cascades access codes
  await db.query("DELETE FROM nodes WHERE matter_id = $1", [MATTER]); // cascades consent, shared_items, replies
}

after(async () => {
  if (ready) await cleanup();
  await db.end();
});

test("provider signs in with email and code; a wrong code is refused", async (t) => {
  if (!ready) return t.skip("server or database not reachable");
  assert.equal((await post("/api/auth/provider", "", { email: "a@access.test", code: "BBBBB-BBBBB" })).status, 401);
  const ok = await post("/api/auth/provider", "", { email: "A@access.test", code: "aaaaa aaaaa" });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("set-cookie") ?? "", /cb_session=/);
});

test("provider is kept out of every firm route", async (t) => {
  if (!ready) return t.skip("server or database not reachable");
  const firmPage = await get("/firm", provA);
  assert.ok([303, 307, 308].includes(firmPage.status), `/firm gave ${firmPage.status}`);
  assert.match(firmPage.headers.get("location") ?? "", /\/login/);
  for (const tool of ["getSummary", "getMoney", "getOpenItems", "getRecord", "listMatters"]) {
    const r = await get(`/api/case/${tool}?matterId=${MATTER}`, provA);
    assert.ok([401, 403].includes(r.status), `${tool} gave ${r.status}`);
  }
  assert.equal((await get(`/api/share?matterId=${MATTER}`, provA)).status, 403);
  const body = { matterId: MATTER, providerNodeId: ids.a, category: "coverage", granted: true };
  assert.equal((await post("/api/share/consent", provA, body)).status, 403);
  assert.equal((await post("/api/share/publish", provA, body)).status, 403);
  assert.equal((await post("/api/share/code", provA, body)).status, 403);
  assert.equal((await post("/api/share/lien", provA, { ...body, action: "request_reduction", amount: 1 })).status, 403);
  assert.equal((await post("/api/voice", provA, { matterId: MATTER, message: "hi" })).status, 403);
});

test("provider cannot see or write another provider's data", async (t) => {
  if (!ready) return t.skip("server or database not reachable");
  const own = await get(`/api/provider/case?matterId=${MATTER}`, provA);
  assert.equal(own.status, 200);
  const data = await own.json();
  assert.deepEqual(data.items.map((i: { payload: { id: string }[] }) => i.payload[0].id), [`open-test-${ids.a}`]);
  // B's request id on the same matter: refused.
  assert.equal((await post("/api/provider/reply", provA, { matterId: MATTER, requestId: `open-test-${ids.b}`, reply: "not_proceeding" })).status, 404);
  assert.equal((await post("/api/provider/reply", provA, { matterId: MATTER, requestId: `open-test-${ids.a}`, reply: "not_proceeding" })).status, 200);
  const replies = await db.query("SELECT r.provider_node_id FROM provider_replies r JOIN shared_items s ON s.id = r.shared_item_id WHERE s.matter_id = $1", [MATTER]);
  assert.deepEqual(replies.rows.map((r) => Number(r.provider_node_id)), [ids.a]);
  // A forged cookie naming B's node still only reaches A's data: access follows the user row, not the cookie's node.
  const forged = cookie({ userId: ids.ua, role: "provider", providerNodeId: ids.b });
  const viaForged = await (await get(`/api/provider/case?matterId=${MATTER}`, forged)).json();
  assert.equal(viaForged.nodeId, ids.a);
  // A cookie not signed with the server's secret is no session at all.
  assert.equal((await get(`/api/provider/case?matterId=${MATTER}`, provA.replace(/\.[^.]+$/, ".bad"))).status, 403);
});

test("publishing a category without consent is refused", async (t) => {
  if (!ready) return t.skip("server or database not reachable");
  const r = await post("/api/share/publish", firm, { matterId: MATTER, providerNodeId: ids.a, categories: ["coverage"] });
  assert.equal(r.status, 403);
  assert.deepEqual((await r.json()).refused, ["coverage"]);
  const n = await db.query("SELECT count(*) FROM shared_items WHERE matter_id = $1 AND category = 'coverage'", [MATTER]);
  assert.equal(Number(n.rows[0].count), 0);
});

test("revoking consent hides the category; revoking the code ends access", async (t) => {
  if (!ready) return t.skip("server or database not reachable");
  await db.query("UPDATE consent SET revoked_at = now() WHERE provider_node_id = $1", [ids.a]);
  assert.equal((await get(`/api/provider/case?matterId=${MATTER}`, provA)).status, 404);
  await db.query("UPDATE consent SET revoked_at = NULL WHERE provider_node_id = $1", [ids.a]);
  await db.query("UPDATE access_codes SET revoked_at = now() WHERE user_id = $1", [ids.ua]);
  assert.equal((await get(`/api/provider/case?matterId=${MATTER}`, provA)).status, 403);
  const page = await get("/provider", provA);
  assert.match(page.headers.get("location") ?? "", /\/login\?revoked=1/);
});
