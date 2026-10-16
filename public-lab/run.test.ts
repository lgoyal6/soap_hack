import assert from "node:assert/strict";
import { test } from "node:test";
import { runScenario } from "./run.ts";

test("actual publisher commits once, retries unchanged and rejects stale or unauthorized inputs", async () => {
  const base = { consent: true, stale: false, retry: true, recipient: "member" };
  const good = await runScenario(base);
  assert.equal(good.outcome, "published");
  assert.deepEqual(good.counts, { shared_items: 1, publish_jobs: 2, outbox: 1 });
  for (const [patch, status] of [[{ consent: false }, 403], [{ stale: true }, 409], [{ recipient: "outsider" }, 404]] as const) {
    const result = await runScenario({ ...base, ...patch });
    assert.equal(result.status, status);
    assert.deepEqual(result.counts, { shared_items: 0, publish_jobs: 0, outbox: 0 });
  }
  await assert.rejects(runScenario({ ...base, databaseUrl: "http://localhost" }));
});
