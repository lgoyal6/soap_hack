// Owner: Laksh. Run: node --experimental-strip-types --test tests/voice/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCites, numbersFromData, splitSentences, unsupported } from "../../lib/voice/check.ts";

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
