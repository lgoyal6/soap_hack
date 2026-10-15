// Deterministic synthetic benchmark. These are authored claims, not model outputs or customer observations.
// Each case is one independent synthetic matter with three provider records and twenty adjudicated claims.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import { extractCites, ground, groundText, indexEvidence, newEvidence, numbersFromData, unsupported, userClaims } from "../../lib/voice/check.ts";

type Row = { text: string; expected: boolean; template?: string; provider?: number; stale?: boolean; search?: { records: number; pages: number; done: number } };
const names = (m: number) => [`Matter ${m + 1} Harbor Clinic`, `Matter ${m + 1} Cedar Therapy`, `Matter ${m + 1} Summit Imaging`];
const sourceId = (m: number, p: number) => 100 + m * 3 + p;

function makeMatter(m: number) {
  const providers = names(m);
  const records = providers.map((provider, p) => ({
    source: sourceId(m, p), provider,
    amount: 3100 + m * 10 + p,
    requestCount: m + p + 1,
    treatmentDate: `2025-${String(m + 1).padStart(2, "0")}-${String(p + 1).padStart(2, "0")}`,
    delayDays: 7 + m * 3 + p,
  }));
  const [a, b, c] = records;
  const [na, nb, nc] = providers;
  const rows: Row[] = [
    { text: `${na} billed $${a.amount} [${a.source}].`, expected: true },
    { text: `${nb} was asked ${b.requestCount} times [${b.source}].`, expected: true },
    { text: `${nc} treated the client on ${c.treatmentDate} [${c.source}].`, expected: true },
    { text: `${nc} took ${c.delayDays} days to reply [${c.source}].`, expected: true },
    { text: `The bill was ${a.amount} [${a.source}].`, expected: true },
    { text: `${nb} billed $${a.amount} [${b.source}].`, expected: false },
    { text: `${nb} billed $${b.amount} [${a.source}].`, expected: false },
    { text: `${nb} billed $${b.requestCount} [${b.source}].`, expected: false },
    { text: `${na} billed $999999 [${a.source}].`, expected: false },
    { text: `${na} billed $${a.amount}.`, expected: false },
    { text: `${na} billed $${a.amount} [${a.source}].`, expected: false, provider: 0, stale: true },
    { text: "No record was found.", expected: false },
    { text: `No record was found after searching 5 pages [${a.source}].`, expected: false, search: { records: 3, pages: 5, done: 3 } },
    { text: "No record was found in 3 records across 5 pages.", expected: true, search: { records: 3, pages: 5, done: 5 } },
    { text: `${nb} has a record [${a.source}].`, expected: false },
    { text: `${na} has a record.`, expected: false },
    { text: "You said the bill was $99.", expected: true, provider: 0 },
    { text: `${na} has a record [999999].`, expected: false },
    { text: `${na} was treated on ${b.treatmentDate} [${a.source}].`, expected: false },
    { text: "No record was found after a complete search.", expected: true, search: { records: 0, pages: 0, done: 0 } },
  ].map((row, i) => ({ ...row, template: `T${String(i + 1).padStart(2, "0")}` }));
  return { records, rows };
}

function evaluate(row: Row, records: ReturnType<typeof makeMatter>["records"], matter: number) {
  const selected = records.map((r) => ({ ...r, stale: row.stale && r.source === sourceId(matter, row.provider ?? -1) }));
  const raw: Record<string, unknown> = { items: selected };
  if (row.search) {
    raw.searched = { records: row.search.records, pages: row.search.pages };
    raw.pagesRead = { done: row.search.done, total: row.search.pages };
  }
  const ev = indexEvidence(raw, newEvidence());
  const { text, cites } = extractCites(row.text);
  const user = userClaims(row.text.startsWith("You said") ? [row.text] : []);
  const allowed = numbersFromData(raw);
  numbersFromData(row.text.startsWith("You said") ? [row.text] : [], allowed);
  const baseline = unsupported(text, allowed).length === 0;
  return { baseline, candidate: ground(text, cites, ev, user), text, raw };
}

test("source grounding catches value, unit, entity, citation, stale and incomplete-search swaps", () => {
  const totals = { rows: 0, baselineAccepted: 0, candidateAccepted: 0, baselineFalseAccepts: 0, baselineFalseRejects: 0, candidateFalseAccepts: 0, candidateFalseRejects: 0 };
  const heldout = { rows: 0, baselineAccepted: 0, candidateAccepted: 0, baselineFalseAccepts: 0, candidateFalseAccepts: 0 };
  const perMatter: number[] = [];
  const auditRows: Record<string, unknown>[] = [];
  for (let m = 0; m < 10; m++) {
    const { records, rows } = makeMatter(m);
    assert.equal(rows.length, 20);
    let correct = 0;
    for (const [i, row] of rows.entries()) {
      const got = evaluate(row, records, m);
      const actual = got.candidate.ok;
      const split = i >= 15 ? "heldout-template" : "development-template";
      totals.rows++;
      totals.baselineAccepted += Number(got.baseline);
      totals.candidateAccepted += Number(actual);
      totals.baselineFalseAccepts += Number(got.baseline && !row.expected);
      totals.baselineFalseRejects += Number(!got.baseline && row.expected);
      totals.candidateFalseAccepts += Number(actual && !row.expected);
      totals.candidateFalseRejects += Number(!actual && row.expected);
      if (split === "heldout-template") {
        heldout.rows++;
        heldout.baselineAccepted += Number(got.baseline);
        heldout.candidateAccepted += Number(actual);
        heldout.baselineFalseAccepts += Number(got.baseline && !row.expected);
        heldout.candidateFalseAccepts += Number(actual && !row.expected);
      }
      auditRows.push({ matter: `synthetic-${String(m + 1).padStart(2, "0")}`, template: row.template, split, claim: row.text, expectedAccepted: row.expected, baselineAccepted: got.baseline, candidateAccepted: actual, candidateReasons: got.candidate.reasons, evidence: got.raw, userClaim: row.text.startsWith("You said") });
      if (actual === row.expected) correct++;
      assert.equal(actual, row.expected, `matter ${m + 1}: ${row.text}; reasons=${JSON.stringify(got.candidate.reasons)}`);
    }
    perMatter.push(correct / rows.length);
  }
  assert.equal(totals.rows, 200);
  assert.ok(totals.baselineFalseAccepts > 0, "the old any-tool-number check must demonstrate a failing negative control");
  assert.equal(totals.candidateFalseAccepts, 0);
  assert.equal(totals.candidateFalseRejects, 0);
  const summary = { matters: 10, providersPerMatter: 3, claimChecks: totals.rows, templatesPerMatter: 20, split: { developmentTemplates: 15, heldoutTemplates: 5 }, totals, heldout, perMatter };
  if (process.env.H2_GROUNDING_FIXTURE_OUTPUT) writeFileSync(process.env.H2_GROUNDING_FIXTURE_OUTPUT, `${JSON.stringify({ protocol: "H2 synthetic grounding v1", summary, rows: auditRows }, null, 2)}\n`);
  console.log(`SYNTHETIC_GROUNDING_EVAL ${JSON.stringify(summary)}`);
});

test("shared draft and message guard rejects a wrong-provider claim", () => {
  const { records } = makeMatter(0);
  const [a, b] = records;
  const ev = indexEvidence({ items: records }, newEvidence());
  const result = groundText(`${b.provider} billed $${b.amount} [${a.source}].`, ev);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.code === "number_from_uncited_source"));
  assert.ok(result.reasons.some((r) => r.code === "entity_not_in_cited_source"));
});

test("a days-open number spoken as a count of asks is rejected (the old any-number check accepts it)", () => {
  // Shape of a get_open_items result as the model sees it, with the same numbers as the fixture case.
  const result = { count: 1, items: [{ waitingOn: "Lakeside Physical Therapy", asks: 2, daysOpen: 120, sources: [1, 2] }] };
  const ev = indexEvidence(result, newEvidence());
  const swapped = "Lakeside Physical Therapy was asked 120 times.";
  assert.deepEqual(unsupported(swapped, numbersFromData(result)), [], "negative control: old check passes it");
  assert.deepEqual(ground(swapped, [1], ev).reasons.map((r) => r.code), ["unit_mismatch"]);
  assert.equal(ground("Lakeside Physical Therapy was asked twice.", [1], ev).ok, true);
  assert.equal(ground("Lakeside Physical Therapy was asked 2 times.", [1], ev).ok, true);
  assert.equal(ground("The request has been open 120 days.", [1], ev).ok, true);
  assert.equal(ground("The request has been open 2 days.", [1], ev).ok, false);
});


test("financial claims preserve positive and negative amounts", () => {
  for (const amount of [100, "100", -100, "-100"]) {
    const ev = indexEvidence({ source: 1, provider: "Harbor Clinic", amount });
    const negative = Number(amount) < 0;
    for (const prefix of ["-$", "$-", "−$"]) {
      assert.equal(ground(`Harbor Clinic billed ${prefix}100.`, [1], ev).ok, negative);
    }
    assert.equal(ground("Harbor Clinic billed $100.", [1], ev).ok, !negative);
    assert.equal(ground("Harbor Clinic billed +$100.", [1], ev).ok, !negative);
  }
});

test("numeric party attribution requires one party per sentence", () => {
  const ev = indexEvidence({ items: [
    { source: 1, provider: "Harbor Clinic", amount: 100 },
    { source: 2, provider: "Cedar Therapy", amount: 200 },
  ] });
  for (const text of [
    "Harbor Clinic billed $200 and Cedar Therapy billed $100.",
    "Harbor Clinic billed $100 and Cedar Therapy billed $200.",
  ]) assert.equal(ground(text, [1, 2], ev).ok, false, "combined attribution needs separate sentences");
  assert.equal(groundText("Harbor Clinic billed $100 [1]. Cedar Therapy billed $200 [2].", ev).ok, true);
  assert.equal(groundText("Harbor Clinic billed $200 [1]. Cedar Therapy billed $100 [2].", ev).ok, false);
});
