// Rehearse the documented publish-schema rollback on a disposable database.
// Preserve provider-visible rows while proving the older schema remains writable.
// Audit/idempotency metadata is deliberately removed by rollback, not recovered.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeTestDb } from "./pgtest.ts";

test("publish migration rollback preserves snapshots and old writes; forward repair restores schema", async (tc) => {
  const db = await makeTestDb({ max: 1 });
  if (!db) return tc.skip("TEST_DATABASE_URL not set");
  try {
    const { rows: [node] } = await db.pool.query(
      "INSERT INTO nodes (matter_id,type,name,norm_name) VALUES (999991,'provider','Recovery fixture','recovery fixture') RETURNING id",
    );
    const payload = { stage: "Treatment" };
    await db.pool.query(
      "INSERT INTO shared_items (matter_id,provider_node_id,category,label,payload,source_revision,request_id) VALUES (999991,$1,'stage','Case stage',$2,'fixture-revision','fixture-request')",
      [node.id, payload],
    );
    await db.pool.query("BEGIN");
    try {
      await db.pool.query("DROP TABLE publish_jobs; DROP TABLE publish_heads; ALTER TABLE shared_items DROP COLUMN source_revision, DROP COLUMN request_id");
      await db.pool.query("COMMIT");
    } catch (error) {
      await db.pool.query("ROLLBACK");
      throw error;
    }
    const { rows } = await db.pool.query("SELECT payload FROM shared_items WHERE provider_node_id=$1", [node.id]);
    assert.deepEqual(rows.map((row) => row.payload), [payload]);
    await db.pool.query(
      "INSERT INTO shared_items (matter_id,provider_node_id,category,label,payload) VALUES (999991,$1,'requests','Requests','[]')",
      [node.id],
    );
    await db.pool.query(readFileSync(new URL("../../db/03_publish_jobs.sql", import.meta.url), "utf8"));
    const repaired = await db.pool.query("SELECT category,source_revision,request_id FROM shared_items WHERE provider_node_id=$1 ORDER BY id", [node.id]);
    assert.deepEqual(repaired.rows, [
      { category: "stage", source_revision: null, request_id: null },
      { category: "requests", source_revision: null, request_id: null },
    ]);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM publish_jobs")).rows[0].n, 0);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM publish_heads")).rows[0].n, 0);
  } finally {
    await db.drop();
  }
});
