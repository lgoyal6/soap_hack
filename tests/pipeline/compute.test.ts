// Run: node --experimental-strip-types --test tests/pipeline/
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeOpenItems, netToClient, quoteFound, resolveRelativeDates, unsupportedNumbers, type CommIn } from "../../lib/pipeline/compute.ts";

const comm = (clioId: number, date: string, direction: "out" | "in", kind: CommIn["kind"], resolves = false): CommIn => ({
  clioId, date, subject: `msg ${clioId}`, direction, counterparty: "Lakeside PT", thread: "pt-file", kind, resolves, party: "provider",
});

test("open item counts asks since the last resolving reply and shows disagreeing counts", () => {
  const items = computeOpenItems({
    comms: [
      comm(1, "2025-01-01", "out", "request"),
      comm(2, "2025-01-10", "in", "reply", true), // resolved: earlier ask no longer counts
      comm(3, "2025-03-01", "out", "request"),
      comm(4, "2025-04-15", "out", "request"),
      comm(5, "2025-04-20", "in", "reply", false), // "we'll get back to you" does not close it
    ],
    tasks: [{ clioId: 9, name: "PT ledger", due: "2025-04-01", done: false, thread: "pt-file", party: "provider", waitingOn: "Lakeside PT" }],
    counts: [{ thread: "pt-file", value: 3, source: { resource: "notes", clioId: 7 } }],
    replies: [{ requestId: "open-pt-file", reply: "sending_by", replyDate: "2025-05-10", at: "2025-05-02T10:00:00Z" }],
    today: "2025-05-01",
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].asks, 2);
  assert.equal(items[0].daysOpen, 61);
  assert.deepEqual(items[0].otherCounts.map((c) => c.value), [3]);
  assert.equal(items[0].providerReply?.reply, "sending_by");
  assert.equal(items[0].sources.length, 3); // two asks + the task
});

test("a resolved thread with no pending task is not an open item", () => {
  const items = computeOpenItems({
    comms: [comm(1, "2025-01-01", "out", "request"), comm(2, "2025-01-10", "in", "reply", true)],
    tasks: [{ clioId: 9, name: "done task", due: null, done: true, thread: "pt-file", party: "us", waitingOn: "us" }],
    counts: [], replies: [], today: "2025-05-01",
  });
  assert.equal(items.length, 0);
});

test("numbers must come from the allowed text", () => {
  assert.deepEqual(unsupportedNumbers("They asked five times over 150 days.", ["asks: 5", "daysOpen: 150"]), []);
  assert.deepEqual(unsupportedNumbers("The limit is $250,000.", ["limit 100,000"]), ["250000"]);
  assert.deepEqual(unsupportedNumbers("Asked twice.", ["asks: 3"]), ["2"]);
});

test("quotes are matched ignoring case, spacing and curly quotes", () => {
  assert.ok(quoteFound("the  client’s own policy", "Under the client's own policy, nothing is added."));
  assert.ok(!quoteFound("a police report was filed", "No police report has been obtained."));
});

test("relative incident dates resolve to real dates", () => {
  assert.deepEqual(resolveRelativeDates("performed at DOI + 94", "2023-04-23"), [{ match: "DOI + 94", date: "2023-07-26" }]);
});

test("net to client shows its arithmetic", () => {
  const n = netToClient(90000, 1 / 3, 500, [{ label: "lien", amount: 10000 }]);
  assert.equal(n.amount, 49500);
  assert.equal(n.formula, "recovery - fee - firm spend - lien");
});
