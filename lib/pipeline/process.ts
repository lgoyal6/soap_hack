// Owner: Tijil. Turns synced records into the cached sections the tools serve.
// Each record is read by a model once (keyed by a hash of its text); a re-run only touches what changed.
import { createHash } from "node:crypto";
import { q } from "../db";
import type { Conflict, Lane, Money, MoneyLine, NotDone, OpenItem, Party, SourceRef, Summary, TimelineEvent } from "../contracts";
import { addDays, computeOpenItems, daysBetween, netToClient, norm, numbersIn, quoteFound, unsupportedNumbers, type CommIn, type CountIn, type TaskIn } from "./compute";
import { extractFacts, groupConflicts, groupNotDone, tagThreads, writeSummary, type Group, type RawFact, type SummarySentence, type ThreadTag } from "./extract";
import { customFieldRecords, loadContacts, loadMatter, loadRecords, type Rec } from "./records";

/* eslint-disable @typescript-eslint/no-explicit-any */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const key = (r: { resource: string; clioId: number }) => `${r.resource}:${r.clioId}`;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " ..." : s);
const ref = (r: { resource: string; clioId: number }, quote?: string): SourceRef => ({ resource: r.resource, clioId: r.clioId, ...(quote ? { quote } : {}) });

// Settings, not case data. The fee is not in the file, so it is an assumption the page labels as one.
const FEE_FRACTION = Number(process.env.FEE_FRACTION) || 1 / 3;
// Task-name convention marking a request addressed to a medical provider.
const PROVIDER_TASK_PREFIX = process.env.PROVIDER_TASK_PREFIX ?? "By medical provider:";

export async function readSection<T>(matterId: number, name: string): Promise<T | null> {
  const [row] = await q<{ data: T }>("SELECT data FROM sections WHERE matter_id = $1 AND name = $2", [matterId, name]);
  return row?.data ?? null;
}

async function writeSection(matterId: number, name: string, inputHash: string, data: unknown) {
  await q(
    `INSERT INTO sections (matter_id, name, data, input_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT (matter_id, name) DO UPDATE SET data = $3, input_hash = $4, built_at = now()`,
    [matterId, name, JSON.stringify(data), inputHash],
  );
}

/** Returns the stored result when the inputs have not changed; otherwise builds and stores it. */
async function cached<T>(matterId: number, name: string, inputHash: string, build: () => Promise<T>): Promise<T> {
  const [row] = await q<{ data: T }>("SELECT data FROM sections WHERE matter_id = $1 AND name = $2 AND input_hash = $3", [matterId, name, inputHash]);
  if (row) return row.data;
  const data = await build();
  await writeSection(matterId, name, inputHash, data);
  return data;
}

async function inBatches<T>(items: T[], size: number, parallel: number, fn: (batch: T[]) => Promise<void>) {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  for (let i = 0; i < batches.length; i += parallel) await Promise.all(batches.slice(i, i + parallel).map(fn));
}

type FactRow = { id: number; type: string; subject: string | null; value: any; quote: string; resource: string; clio_id: number; fact_date: string | null };

async function loadFacts(matterId: number): Promise<FactRow[]> {
  const rows = await q<any>("SELECT id, type, subject, value, quote, resource, clio_id, fact_date FROM facts WHERE matter_id = $1 ORDER BY fact_date NULLS LAST, id", [matterId]);
  return rows.map((r) => ({ ...r, id: Number(r.id), clio_id: Number(r.clio_id), fact_date: r.fact_date ? new Date(r.fact_date).toISOString() : null }));
}
const factRef = (f: FactRow): SourceRef => ({ resource: f.resource, clioId: f.clio_id, quote: f.quote });
const factLine = (f: FactRow) => ({ id: f.id, type: f.type, subject: f.subject, date: f.fact_date, quote: f.quote });

/** Keeps a model-written label only if it carries no number of its own. */
const safeLabel = (label: string, fallback: string) => (label && unsupportedNumbers(label, []).length === 0 ? label : fallback.replace(/-/g, " "));

export type ProcessReport = { records: number; extracted: number; facts: number; dropped: number; openItems: number; conflicts: number; notDone: number };

export async function processMatter(matterId: number): Promise<ProcessReport> {
  const matter = await loadMatter(matterId);
  if (!matter) throw new Error(`Matter ${matterId} has not been synced`);
  const today = new Date().toISOString().slice(0, 10);
  const recs = await loadRecords(matterId, ["notes", "communications", "tasks", "calendar_entries", "activities", "documents"]);
  const fields = customFieldRecords(matter);
  const contacts = await loadContacts(matterId);
  const byKey = new Map<string, Rec>([...recs, ...fields].map((r) => [key(r), r]));

  // ---- 1. Threads ------------------------------------------------------------
  // Identical bodies sent the same day are one message, not two asks.
  const seen = new Set<string>();
  const comms = recs.filter((r) => r.resource === "communications" && r.date).filter((r) => {
    const k = `${r.date!.slice(0, 10)}|${norm(String(r.data.body ?? r.text))}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const tasks = recs.filter((r) => r.resource === "tasks");
  const isOut = (c: Rec) => (c.data.senders ?? []).some((s: any) => s?.type === "User");
  const partyNames = (c: Rec) => ((isOut(c) ? c.data.receivers : c.data.senders) ?? []).map((p: any) => p?.name).filter(Boolean).join(", ");
  const threadLines = [
    ...comms.map((c) => `[${key(c)}] ${c.date!.slice(0, 10)} ${isOut(c) ? "FIRM TO" : "TO FIRM FROM"} ${partyNames(c)} | ${c.title} | ${clip(String(c.data.body ?? ""), 500)}`),
    ...tasks.map((t) => `[${key(t)}] TASK (${t.data.status}) due ${t.date?.slice(0, 10) ?? "none"} | ${t.title} | ${clip(t.text, 300)}`),
  ];
  // A failed model call is never cached: the section is simply empty until the next run.
  const tags = await cached<ThreadTag[]>(matterId, "tags", sha(threadLines.join("\n")), () => tagThreads(threadLines)).catch(() => [] as ThreadTag[]);
  const tagBy = new Map(tags.map((t) => [t.id, t]));
  const slugs = [...new Set(tags.map((t) => t.thread))];

  // ---- 2. Facts, once per record ----------------------------------------------
  const incidentField = fields.find((f) => f.data.field_type === "date" && /incident|accident|loss|injur/i.test(f.title));
  const incidentDate = incidentField ? String(incidentField.text).slice(0, 10) : null;

  const markers = new Map((await q<{ name: string; input_hash: string }>("SELECT name, input_hash FROM sections WHERE matter_id = $1 AND name LIKE 'rec:%'", [matterId])).map((m) => [m.name, m.input_hash]));
  const readable = [...byKey.values()].filter((r) => r.resource !== "documents" && r.text.trim());
  const todo = readable.filter((r) => markers.get(`rec:${key(r)}`) !== sha(r.title + "\n" + r.text));
  let dropped = 0;

  await inBatches(todo, 8, 4, async (batch) => {
    const res = await extractFacts(batch, slugs).catch(() => null);
    if (!res) return; // left unmarked, so the next run retries these records
    const { facts, lanes } = res as { facts: RawFact[]; lanes: { record: string; lane: Lane }[] };
    const laneBy = new Map(lanes.map((l) => [l.record, l.lane]));
    for (const r of batch) {
      const source = r.title + "\n" + r.text;
      await q("DELETE FROM facts WHERE matter_id = $1 AND resource = $2 AND clio_id = $3", [matterId, r.resource, r.clioId]);
      for (const f of facts.filter((f) => f.record === key(r))) {
        // Trust rule: the quote must be in the record, and any number must be in the quote.
        if (!f.quote || !quoteFound(f.quote, source)) { dropped++; continue; }
        const inQuote = new Set(numbersIn(f.quote));
        const has = (n: unknown) => typeof n === "number" && inQuote.has(String(n).replace(/\.0+$/, ""));
        const value = {
          amount: has(f.amount) ? f.amount : null,
          count: has(f.count) ? f.count : null,
          category: f.category ?? null,
          thread: f.thread && slugs.includes(f.thread) ? f.thread : null,
          daysAfterIncident: has(f.days_after_incident) ? f.days_after_incident : null,
        };
        if (f.type === "count" && value.count === null) { dropped++; continue; }
        await q(
          `INSERT INTO facts (matter_id, type, subject, value, quote, resource, clio_id, fact_date, source_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [matterId, f.type, f.subject ?? null, JSON.stringify(value), f.quote, r.resource, r.clioId, r.date, sha(source)],
        );
      }
      await writeSection(matterId, `rec:${key(r)}`, sha(source), { lane: laneBy.get(key(r)) ?? null });
    }
  });

  const facts = await loadFacts(matterId);
  const lanes = new Map((await q<{ name: string; data: any }>("SELECT name, data FROM sections WHERE matter_id = $1 AND name LIKE 'rec:%'", [matterId])).map((m) => [m.name.slice(4), m.data?.lane as Lane | null]));

  // ---- 3. Open items (code) ---------------------------------------------------
  const commIn: CommIn[] = comms.flatMap((c) => {
    const t = tagBy.get(key(c));
    return t ? [{ clioId: c.clioId, date: c.date!, subject: c.title, direction: isOut(c) ? "out" as const : "in" as const, counterparty: partyNames(c), thread: t.thread, kind: t.kind, resolves: !!t.resolves, party: t.party }] : [];
  });
  // The limitations task is shown in the header from the firm's own entry, not as an open item.
  const solTaskId = Number(matter.statute_of_limitations?.id) || -1;
  const taskIn: TaskIn[] = tasks.filter((t) => t.clioId !== solTaskId).map((t) => {
    const tag = tagBy.get(key(t));
    const forProvider = t.title.startsWith(PROVIDER_TASK_PREFIX);
    return {
      clioId: t.clioId, name: t.title, due: t.date, done: /complete/i.test(String(t.data.status ?? "")),
      thread: tag?.thread ?? null,
      party: forProvider ? "provider" as Party : tag?.party ?? "us",
      waitingOn: forProvider ? t.title.slice(PROVIDER_TASK_PREFIX.length).split(" - ")[0].trim() : String(t.data.assignee?.name ?? "the firm"),
    };
  });
  const counts: CountIn[] = facts.filter((f) => f.type === "count" && f.value?.thread && f.value?.count != null).map((f) => ({ thread: f.value.thread, value: f.value.count, source: factRef(f) }));
  const openItems: OpenItem[] = computeOpenItems({ comms: commIn, tasks: taskIn, counts, replies: [], today });
  await writeSection(matterId, "open_items", today, openItems);

  // ---- 4. Conflicts and not-yet-done (model groups, code builds) ---------------
  const factBy = new Map(facts.map((f) => [f.id, f]));
  const pick = (g: Group) => [...new Set(g.fact_ids ?? [])].map((id) => factBy.get(Number(id))).filter((f): f is FactRow => !!f);

  const conflictFacts = facts.filter((f) => ["coverage", "amount", "count", "frequency", "position"].includes(f.type));
  const conflictGroups = await cached<Group[]>(matterId, "conflict_groups", sha(JSON.stringify(conflictFacts.map(factLine))), () => groupConflicts(conflictFacts.map(factLine))).catch(() => [] as Group[]);
  const conflicts: Conflict[] = conflictGroups.flatMap((g, i) => {
    const fs = pick(g);
    if (new Set(fs.map((f) => norm(f.quote))).size < 2) return [];
    return [{ id: `conflict-${i + 1}`, topic: safeLabel(g.label, fs[0].subject ?? "records disagree"), versions: fs.map((f) => ({ value: f.quote, date: f.fact_date?.slice(0, 10) ?? null, sources: [factRef(f)] })) }];
  });
  await writeSection(matterId, "conflicts", today, conflicts);

  const ndFacts = facts.filter((f) => ["missing", "commitment", "done"].includes(f.type));
  const ndGroups = await cached<Group[]>(matterId, "not_done_groups", sha(JSON.stringify(ndFacts.map(factLine))), () => groupNotDone(ndFacts.map(factLine))).catch(() => [] as Group[]);
  const notDone: NotDone[] = ndGroups.flatMap((g, i) => {
    const fs = pick(g).filter((f) => f.type !== "done");
    const dated = fs.map((f) => f.fact_date).filter((d): d is string => !!d).sort();
    if (!fs.length || !dated.length) return [];
    return [{ id: `nd-${i + 1}`, what: safeLabel(g.label, fs[0].subject ?? "not yet done"), since: dated[0].slice(0, 10), daysOpen: daysBetween(dated[0], today), sources: fs.map(factRef) }];
  }).sort((a, b) => b.daysOpen - a.daysOpen);
  await writeSection(matterId, "not_done", today, notDone);

  // ---- 5. Money (code) --------------------------------------------------------
  // Clio keeps two kinds of expense entry on a matter: the firm's own case costs (billable), and charges
  // recorded for someone else, such as a provider's bills (non-billable). Only the first is firm spend.
  const expenseEntries = recs.filter((r) => r.resource === "activities" && /expense/i.test(String(r.data.type ?? "")));
  const amountOf = (e: Rec) => Number(e.data.total ?? e.data.non_billable_total ?? e.data.price) || 0;
  const expenses = expenseEntries.filter((e) => !e.data.non_billable);
  const charges = expenseEntries.filter((e) => e.data.non_billable);
  const spend = expenses.reduce((s, e) => s + amountOf(e), 0);
  const charged = charges.reduce((s, e) => s + amountOf(e), 0);
  const where = (f: FactRow) => `${byKey.get(key({ resource: f.resource, clioId: f.clio_id }))?.title ?? f.resource}${f.fact_date ? `, ${f.fact_date.slice(0, 10)}` : ""}`;
  const coverage = facts.filter((f) => f.type === "coverage" && f.value?.amount != null);
  const liens = facts.filter((f) => f.type === "amount" && f.value?.category === "lien" && f.value?.amount != null);
  // One line per distinct lien figure, latest statement of it.
  const lienLatest = [...new Map(liens.map((f) => [f.value.amount as number, f])).values()];
  const lines: MoneyLine[] = [
    ...fields.filter((f) => f.data.field_type === "currency" && !Number.isNaN(Number(f.text))).map((f) => ({ label: f.title, amount: Number(f.text), foundation: "the firm's own field", sources: [ref(f)] })),
    ...[...new Map(coverage.map((f) => [f.value.amount as number, f])).values()].map((f) => ({ label: "Coverage limit", amount: f.value.amount as number, foundation: where(f), sources: [factRef(f)] })),
    ...lienLatest.map((f) => ({ label: "Lien", amount: f.value.amount as number, foundation: where(f), sources: [factRef(f)] })),
    ...(charges.length ? [{ label: "Charges recorded on the file", amount: charged, foundation: `sum of ${charges.length} non-billable entries (not firm costs)`, sources: charges.map((e) => ref(e)) }] : []),
    { label: "Firm spend", amount: spend, foundation: `sum of ${expenses.length} expense entries`, sources: expenses.map((e) => ref(e)) },
  ];
  const lowest = coverage.length ? Math.min(...coverage.map((f) => f.value.amount as number)) : null;
  const net = lowest === null ? null : netToClient(lowest, FEE_FRACTION, spend, lienLatest.map((f) => ({ label: "lien", amount: f.value.amount as number })));
  const money: Money = {
    lines,
    netToClient: {
      amount: net?.amount ?? null, formula: net?.formula ?? "", inputs: net?.inputs ?? [],
      assumption: `Illustrative only. Recovery is taken as the lowest coverage figure found in the file; the fee is an assumed ${Math.round(FEE_FRACTION * 100)}% and is not in the file.`,
    },
  };
  await writeSection(matterId, "money", today, money);

  // ---- 6. Timeline (code) -----------------------------------------------------
  const laneFor = (r: Rec): Lane => lanes.get(key(r)) ?? (r.resource === "communications" ? "communications" : r.resource === "activities" ? "money" : "legal");
  const timeline: TimelineEvent[] = [
    ...recs.filter((r) => r.date && r.resource !== "documents").map((r) => ({
      date: r.date!.slice(0, 10), lane: laneFor(r), title: r.title,
      ...(r.resource === "activities" ? { amount: amountOf(r), amountKind: r.data.non_billable ? "charge" as const : "firm_cost" as const } : {}),
      sources: [ref(r)],
    })),
    // Events the file dates relative to the incident are placed on their real date.
    ...(incidentDate ? facts.filter((f) => f.type === "event" && f.value?.daysAfterIncident != null).map((f) => ({
      date: addDays(incidentDate, f.value.daysAfterIncident), lane: "medical" as Lane, title: (f.subject ?? "event").replace(/-/g, " "), sources: [factRef(f)],
    })) : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  await writeSection(matterId, "timeline", today, timeline);

  // ---- 7. Summary (header by code; sentences by model, checked) ----------------
  const client = contacts.find((c) => c.isClient);
  const withClient = client ? comms.filter((c) => [...(c.data.senders ?? []), ...(c.data.receivers ?? [])].some((p: any) => Number(p?.id) === client.id)) : [];
  const lastClient = withClient[withClient.length - 1];
  const sol = matter.statute_of_limitations;
  const photo = recs.find((r) => r.resource === "documents" && /photo/i.test(r.title));
  const [pages] = await q<{ done: string; total: string }>(
    "SELECT count(*) FILTER (WHERE status = 'done') AS done, count(*) AS total FROM scan_pages WHERE document_id = ANY($1)",
    [recs.filter((r) => r.resource === "documents").map((r) => r.clioId)],
  );
  const decisions = facts.filter((f) => f.type === "decision");
  const state = {
    open_items: openItems.map((o) => ({ id: o.id, what: o.what, waiting_on: o.waitingOn, party: o.party })),
    conflicts: conflicts.map((c) => ({ id: c.id, topic: c.topic })),
    not_done: notDone.map((n) => ({ id: n.id, what: n.what })),
    decisions: decisions.map((f) => ({ id: `fact-${f.id}`, quote: f.quote })),
  };
  const stateJson = JSON.stringify(state);
  const sourcesOf = new Map<string, SourceRef[]>([
    ...openItems.map((o) => [o.id, o.sources] as [string, SourceRef[]]),
    ...conflicts.map((c) => [c.id, c.versions.flatMap((v) => v.sources)] as [string, SourceRef[]]),
    ...notDone.map((n) => [n.id, n.sources] as [string, SourceRef[]]),
    ...decisions.map((f) => [`fact-${f.id}`, [factRef(f)]] as [string, SourceRef[]]),
  ]);
  const written = await cached<SummarySentence[]>(matterId, "summary_sentences", sha(stateJson), () => writeSummary(stateJson)).catch(() => [] as SummarySentence[]);
  const sentences = written
    .map((s) => ({ text: s.text, sources: (s.item_ids ?? []).flatMap((id) => sourcesOf.get(id) ?? []) }))
    // Trust rule: no sentence without a source, and no number the computed state does not contain.
    .filter((s) => s.sources.length > 0 && unsupportedNumbers(s.text, [stateJson]).length === 0);
  const summary: Summary = {
    header: {
      clientName: String(matter.client?.name ?? ""),
      photoDocumentId: photo?.clioId ?? null,
      stage: matter.matter_stage?.name ?? null,
      lastClientContact: lastClient ? { date: lastClient.date!.slice(0, 10), sources: [ref(lastClient)] } : null,
      // Never computed: the date and status are the firm's own limitations task.
      limitations: sol ? { date: sol.due_at ? String(sol.due_at).slice(0, 10) : null, status: String(sol.status ?? "unknown"), sources: sol.id ? [{ resource: "tasks", clioId: Number(sol.id) }] : [] } : null,
      firmSpend: { amount: spend, sources: expenses.map((e) => ref(e)) },
      pagesRead: { done: Number(pages?.done ?? 0), total: Number(pages?.total ?? 0) },
    },
    sentences,
  };
  await writeSection(matterId, "summary", today, summary);

  // ---- 8. Search index and case graph (code) -----------------------------------
  for (const r of byKey.values()) {
    await q(
      `INSERT INTO search_index (matter_id, resource, clio_id, title, body) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (resource, clio_id, page_no) DO UPDATE SET title = $4, body = $5`,
      [matterId, r.resource, r.clioId, r.title, r.text],
    );
  }
  const nodeType = (c: (typeof contacts)[number]) =>
    c.isClient ? "person"
    : /provid|hospital|surg|therap|chiropr|medical|treat|clinic|physician|doctor/i.test(c.relationship ?? "") ? "provider"
    : /insur|carrier|adjust|claims/i.test(c.relationship ?? "") ? "insurer" : "party";
  const nodeId = new Map<number, number>();
  for (const c of contacts) {
    const [n] = await q<{ id: string }>(
      `INSERT INTO nodes (matter_id, type, name, norm_name, clio_contact_id, props) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (matter_id, type, norm_name) DO UPDATE SET name = $3, clio_contact_id = $5, props = $6 RETURNING id`,
      [matterId, nodeType(c), c.name, norm(c.name).replace(/[^a-z0-9 ]/g, ""), c.id, JSON.stringify({ email: c.email, relationship: c.relationship })],
    );
    nodeId.set(c.id, Number(n.id));
  }
  if (client && nodeId.has(client.id)) {
    await q("DELETE FROM edges WHERE src = $1", [nodeId.get(client.id)]);
    for (const c of contacts.filter((c) => !c.isClient)) {
      await q("INSERT INTO edges (src, dst, type) VALUES ($1,$2,$3)", [nodeId.get(client.id), nodeId.get(c.id), c.relationship ?? "related"]);
    }
  }

  return { records: byKey.size, extracted: todo.length, facts: facts.length, dropped, openItems: openItems.length, conflicts: conflicts.length, notDone: notDone.length };
}
