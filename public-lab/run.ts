// Execute the production publisher against an isolated in-memory Postgres.
// PGlite supplies SQL semantics; no application DB or outbound sender is used.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { publishSnapshot, revisionOf, ShareError, type PoolLike } from "../lib/portal/publish.ts";

export async function runScenario(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid inputs");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "consent,recipient,retry,stale" ||
      typeof input.consent !== "boolean" || typeof input.stale !== "boolean" || typeof input.retry !== "boolean" ||
      !["member", "outsider"].includes(input.recipient as string)) throw new Error("Invalid bounded inputs");
  const db = new PGlite();
  try {
    for (const name of ["01_core.sql", "02_portal_voice.sql", "03_publish_jobs.sql"]) {
      await db.exec(readFileSync(new URL(`../db/${name}`, import.meta.url), "utf8"));
    }
    await db.exec(`INSERT INTO nodes(id,matter_id,type,name,norm_name,props) VALUES(1,101,'provider','Fictional practice','fictional practice','{"email":"practice@example.test"}');
      INSERT INTO users(id,role,email,provider_node_id) VALUES(1,'firm','firm@example.test',NULL),(2,'provider','practice@example.test',1);
      INSERT INTO access_codes(user_id,code_hash) VALUES(2,'synthetic-non-login-code');`);
    if (input.consent) await db.exec("INSERT INTO consent(provider_node_id,category) VALUES(1,'stage')");
    const snapshots = {
      stage: { label: "Case stage", payload: { stage: "Treatment" } },
      requests: { label: "Requests", payload: [] }, own_bills: { label: "Bills", payload: [] },
      coverage: { label: "Coverage", payload: null }, other_treaters: { label: "Other providers", payload: [] },
    };
    const expected = { stage: revisionOf(snapshots.stage) };
    if (input.stale) snapshots.stage.payload.stage = "Review";
    const pool: PoolLike = { connect: async () => ({
      query: async (sql, params) => ({ rows: (await db.query<Record<string, unknown>>(sql, params)).rows }),
      release: () => {},
    }) };
    const request = { matterId: 101, nodeId: input.recipient === "member" ? 1 : 999,
      userId: 1, requestId: "synthetic-demo-1", patient: "Fictional Client A", snapshots,
      categories: ["stage" as const], expected };
    let result;
    try {
      const first = await publishSnapshot(pool, request);
      const retry = input.retry ? await publishSnapshot(pool, { ...request, requestId: "synthetic-demo-2" }) : null;
      result = { outcome: "published", status: 200, first, retry };
    } catch (error) {
      if (!(error instanceof ShareError)) throw error;
      result = { outcome: "refused", status: error.status, reason: error.message };
    }
    const counts = (await db.query("SELECT (SELECT count(*) FROM shared_items)::int AS shared_items, (SELECT count(*) FROM publish_jobs)::int AS publish_jobs, (SELECT count(*) FROM outbox)::int AS outbox")).rows[0];
    return { input, ...result, counts, previewRevision: expected.stage, currentRevision: revisionOf(snapshots.stage),
      scope: "Actual publishSnapshot and Postgres SQL on request-local synthetic data. Outbox rows are inspected and never delivered. No login, Clio, model or real case database." };
  } finally { await db.close(); }
}
