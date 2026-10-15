// Checks voice claim guards and streamed sentence handling without a server.
// Uses check.ts with valid, unsupported and interrupted response fixtures.
// Deadline cases inspect listener cleanup when the underlying work never ends.
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { DeadlineError, extractCites, ground, indexEvidence, newEvidence, numbersFromData, SentenceStream, splitSentences, unsupported, withDeadline } from "../../lib/voice/check.ts";

test("numbers come from tool data, not from ids or source markers", () => {
  const allowed = numbersFromData({
    id: "open-7", count: 2, sources: [41, 42],
    items: [{ clioId: 9301, asks: 3, firstAsked: "2025-03-01", what: "Ledger requested twice", amount: 1410.5 }],
  });
  assert.ok(allowed.has("2") && allowed.has("3") && allowed.has("2025") && allowed.has("1") && allowed.has("1410.5"));
  assert.ok(!allowed.has("9301") && !allowed.has("41"));
});

test("a sentence with a number no tool returned is flagged", () => {
  const allowed = numbersFromData({ asks: 3, firstAsked: "2025-03-01", limit: "100,000 per person" });
  assert.deepEqual(unsupported("The firm asked three times, first on March 1st, 2025.", allowed), []);
  assert.deepEqual(unsupported("The limit is $100,000.", allowed), []);
  assert.deepEqual(unsupported("That is about four months.", allowed), ["4"]);
  assert.deepEqual(unsupported("Net is roughly $66,000.", allowed), ["66000"]);
  assert.deepEqual(unsupported("Nothing is owed.", allowed), []);
});

test("source markers are removed and collected", () => {
  assert.deepEqual(extractCites("Two limits differ [3][4]."), { text: "Two limits differ.", cites: [3, 4] });
  assert.deepEqual(extractCites("The file was asked for [S2, S5]. "), { text: "The file was asked for.", cites: [2, 5] });
  assert.deepEqual(extractCites("**Open** items."), { text: "Open items.", cites: [] });
});

test("streamed text splits into sentences, keeping abbreviations and trailing markers", () => {
  const a = splitSentences("Dr. Reyes treats the client. The limit is 100,000.50 per person [2]. Next");
  assert.deepEqual(a.done, ["Dr. Reyes treats the client.", "The limit is 100,000.50 per person [2]."]);
  assert.equal(a.rest, "Next");
  assert.deepEqual(splitSentences("Waiting on J. Smith").done, []);
  assert.deepEqual(splitSentences("First line\nSecond! ").done, ["First line", "Second!"]);
});

test("a disconnected stream leaves its incomplete final sentence withheld", () => {
  const stream = new SentenceStream();
  assert.deepEqual(stream.push("The carrier limit is $100,000 [2]. The bill is $"), ["The carrier limit is $100,000 [2]."]);
  // A disconnect throws before flush(), so the partial amount never becomes visible or speakable.
});

test("model and read-only tool waits have a bounded idle deadline", async () => {
  await assert.rejects(withDeadline(new Promise<never>(() => {}), 5), DeadlineError);
  const controller = new AbortController();
  const pending = new Promise<void>((resolve) => setTimeout(resolve, 100));
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(withDeadline(pending, 1000, controller.signal), DeadlineError);
});

test("a refreshed source replaces stale evidence and a fresh search resets unread pages", () => {
  const evidence = newEvidence();
  indexEvidence({ items: [{ source: 7, provider: "Harbor Clinic", amount: 1200, stale: true }] }, evidence);
  assert.equal(ground("Harbor Clinic billed $1200.", [7], evidence).reasons[0]?.code, "stale_source");
  indexEvidence({ items: [{ source: 7, provider: "Harbor Clinic", amount: 1200 }] }, evidence);
  assert.equal(ground("Harbor Clinic billed $1200.", [7], evidence).ok, true);

  indexEvidence({ searched: { records: 4, pages: 4 }, pagesRead: { done: 1, total: 4 } }, evidence);
  assert.equal(ground("No record was found.", [], evidence).reasons[0]?.code, "absence_with_unread_pages");
  indexEvidence({ searched: { records: 4, pages: 0 } }, evidence);
  assert.equal(ground("No record was found.", [], evidence).ok, true);
});


test("idle timeout removes its abort listener even if the operation never settles", async () => {
  const controller = new AbortController();
  await assert.rejects(withDeadline(new Promise<never>(() => {}), 1, controller.signal), DeadlineError);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("a pre-aborted deadline still observes an already rejected operation", () => {
  const moduleUrl = new URL("../../lib/voice/check.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { setImmediate } from "node:timers/promises";
    import { withDeadline, DeadlineError } from ${JSON.stringify(moduleUrl)};
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(withDeadline(Promise.reject(new Error("input failed")), 1000, controller.signal), DeadlineError);
    await setImmediate();
  `], { encoding: "utf8", timeout: 5000 });
  assert.equal(child.status, 0, child.stderr || String(child.error));
});
