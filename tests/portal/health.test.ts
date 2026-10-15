// Exercise the actual liveness handler without starting providers or a database.
// Keep its public response constant so operational probes cannot expose case data.
// Dependency readiness is intentionally outside this endpoint's contract.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../../app/api/health/route.ts";

test("liveness returns a constant non-cacheable response without dependencies", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok", check: "liveness" });
});
