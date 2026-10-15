// Owner: Laksh. The real voice route and agent, through the real `openai` SDK, against the local stand-in endpoint in
// model-stub.ts: grounded vs swapped sentences, a dropped connection mid-sentence, a stalled stream, a retried request,
// and the attorney interrupting. Needs a dev server started with the fixture case and the stub as its model endpoint:
//   USE_FIXTURES=1 GMI_BASE_URL=http://127.0.0.1:55435/v1 GMI_API_KEY=local-stub LLM_MODEL=stub-model \
//     DATABASE_URL=... SESSION_SECRET=... npx next dev -H 127.0.0.1 -p 3312
//   BASE_URL=http://127.0.0.1:3312 VOICE_STUB_PORT=55435 DATABASE_URL=... SESSION_SECRET=... \
//     node --experimental-strip-types --test tests/voice/agent-network.test.ts
// Skips itself when any of those are missing. No real model is called.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { startStub, type StubLog } from "./model-stub.ts";

const BASE = process.env.BASE_URL ?? "";
const PORT = Number(process.env.VOICE_STUB_PORT ?? 0);
const SECRET = process.env.SESSION_SECRET ?? "";
const MATTER = 1; // the fixture case
let stub: Awaited<ReturnType<typeof startStub>> | null = null;
let db: pg.Pool | null = null;
let firm = "";
let userId = 0;

const cookie = (s: object) => {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `cb_session=${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
};

before(async () => {
  if (!BASE || !PORT || !SECRET || !process.env.DATABASE_URL) return;
  try { await fetch(BASE + "/login"); } catch { return; }
  stub = await startStub(PORT);
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await db.query("DELETE FROM users WHERE email = 'voice@network.test'");
  userId = Number((await db.query("INSERT INTO users (role, email) VALUES ('firm','voice@network.test') RETURNING id")).rows[0].id);
  firm = cookie({ userId, role: "firm" });
});
after(async () => {
  if (db) { await db.query("DELETE FROM voice_turns WHERE user_id = $1", [userId]); await db.query("DELETE FROM users WHERE id = $1", [userId]); await db.end(); }
  await stub?.close();
});

type Ev = { type: string; text?: string; numbers?: string[]; message?: string; name?: string; turnId?: number | null };

/** One voice turn; `stopAfter` aborts the request (like the attorney pressing space) once that event arrives. */
async function turn(message: string, stopAfter?: (e: Ev) => boolean) {
  const ctl = new AbortController();
  const res = await fetch(BASE + "/api/voice", {
    method: "POST", headers: { cookie: firm, "Content-Type": "application/json" },
    body: JSON.stringify({ matterId: MATTER, message, reset: true }), signal: ctl.signal,
  });
  assert.equal(res.status, 200);
  const events: Ev[] = [];
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(part, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const e = JSON.parse(line) as Ev;
        events.push(e);
        if (stopAfter?.(e)) ctl.abort();
      }
    }
  } catch (e) { if (!ctl.signal.aborted) throw e; }
  return events;
}
const logFor = (scenario: string): StubLog[] => stub!.log.filter((l) => l.scenario === scenario);
const ready = (tc: { skip: (m: string) => void }) => { if (!stub) { tc.skip("dev server, stub port, DATABASE_URL or SESSION_SECRET missing"); return false; } return true; };

test("grounded sentence spoken, swapped count dropped, unpunctuated ending flushed", async (tc) => {
  if (!ready(tc)) return;
  const ev = await turn("scenario:grounded what are we waiting on?");
  assert.deepEqual(ev.filter((e) => e.type === "tool").map((e) => e.name), ["get_open_items"]);
  const spoken = ev.filter((e) => e.type === "sentence").map((e) => e.text);
  const dropped = ev.filter((e) => e.type === "dropped");
  assert.equal(spoken.length, 2, JSON.stringify(ev));
  assert.match(spoken[0]!, /was asked \d+ times\.$/);
  assert.equal(spoken[1], "That is all");
  assert.equal(dropped.length, 1);
  assert.ok(ev.at(-1)?.type === "done" && ev.at(-1)?.turnId);
});

test("connection dropped mid-sentence: the half sentence is never shown, the turn reports an error and is logged", async (tc) => {
  if (!ready(tc)) return;
  const ev = await turn("scenario:disconnect what are we waiting on?");
  const spoken = ev.filter((e) => e.type === "sentence").map((e) => e.text!);
  assert.equal(spoken.length, 1);
  assert.ok(!spoken.some((s) => /was asked\s*$/.test(s)));
  assert.ok(ev.some((e) => e.type === "error"), JSON.stringify(ev));
  const done = ev.at(-1)!;
  assert.equal(done.type, "done");
  const [row] = (await db!.query("SELECT answer FROM voice_turns WHERE id = $1", [done.turnId])).rows;
  assert.match(row.answer, /\[.+\]$/, "the stored answer records the error");
});

test("stalled stream: the idle deadline ends the turn instead of hanging", { timeout: 90_000 }, async (tc) => {
  if (!ready(tc)) return;
  const t0 = Date.now();
  const ev = await turn("scenario:stall what are we waiting on?");
  const ms = Date.now() - t0;
  assert.equal(ev.filter((e) => e.type === "sentence").length, 1);
  assert.ok(ev.some((e) => e.type === "error" && /time/i.test(e.message ?? "")), JSON.stringify(ev));
  assert.ok(ms >= 29_000 && ms < 60_000, `ended after ${ms} ms`);
  assert.ok(logFor("stall").some((l) => l.round === 2 && l.closedEarly), "the agent closed the stalled upstream request");
});

test("connection refused before any answer: the SDK retries once and nothing is spoken twice", async (tc) => {
  if (!ready(tc)) return;
  const ev = await turn("scenario:drop-before-headers what are we waiting on?");
  const round2 = logFor("drop-before-headers").filter((l) => l.round === 2);
  assert.equal(round2.length, 2, "one dropped attempt plus one retry");
  const spoken = ev.filter((e) => e.type === "sentence").map((e) => e.text);
  assert.equal(spoken.length, 2);
  assert.equal(new Set(spoken).size, spoken.length);
});

test("attorney interrupts: the upstream model request is aborted too", async (tc) => {
  if (!ready(tc)) return;
  await turn("scenario:slow what are we waiting on?", (e) => e.type === "sentence");
  const ok = await (async () => { for (let i = 0; i < 50; i++) { if (logFor("slow").some((l) => l.round === 2 && l.closedEarly)) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })();
  assert.ok(ok, "stub saw the request closed before it finished");
});
