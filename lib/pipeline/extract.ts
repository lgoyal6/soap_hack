// Owner: Tijil. The model-backed steps. The model only labels, groups and quotes; code in
// process.ts verifies every quote and number against the source before anything is stored.
// Prompts are generic: nothing about any particular case appears here.
import { chatJson, MODEL, MODEL_FAST } from "../llm";
import type { Party, Lane } from "../contracts";
import type { Rec } from "./records";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " ..." : s);

// ---- 1. Threads: which messages and tasks belong to the same outstanding request ------------

export type ThreadTag = { id: string; thread: string; kind: "request" | "reply" | "info"; resolves: boolean; party: Party };

const THREAD_SYSTEM = `You organise a law firm's case file. You are given emails, phone-call logs and tasks, one per line, each with an id.
Group them into threads. Items about the same outstanding thing between the firm and the same other party share one thread slug.
A thread slug is short kebab-case made of generic words describing what is being sought and from whom (for example "records-physical-therapy").
For each item return:
- thread: the slug
- kind: "request" if it asks for something to be provided, done or decided; "reply" if it responds to a request; "info" otherwise
- resolves: true only if the item actually delivers or settles what was asked. An acknowledgement, a promise to follow up, or "no date yet" is false.
- party: who the firm is dealing with in this thread: "client", "provider" (medical providers), "defence" (opposing party, their insurer, adjuster or counsel), "court", or "other". Use "us" for a task that is the firm's own work.
Return only a JSON array: [{"id": "...", "thread": "...", "kind": "...", "resolves": false, "party": "..."}] with one entry per item.`;

export async function tagThreads(lines: string[]): Promise<ThreadTag[]> {
  if (!lines.length) return [];
  // ponytail: one call over the whole file keeps slugs consistent; chunk with a running slug list if a file exceeds the context window.
  return chatJson<ThreadTag[]>("tag_threads", THREAD_SYSTEM, lines.join("\n"), MODEL);
}

// ---- 2. Facts: quoted statements pulled from each record -------------------------------------

export type RawFact = {
  record: string;            // the record id given in the prompt
  type: "coverage" | "amount" | "count" | "frequency" | "position" | "missing" | "commitment" | "done" | "injury" | "decision" | "event";
  subject: string;           // kebab-case slug of what the fact is about
  quote: string;             // verbatim from the record
  amount?: number | null;    // money, when the quote states it
  count?: number | null;     // a count, when the quote states it
  category?: string | null;  // for amount: bills | lien | value | wage | offer | cost | other
  thread?: string | null;    // for count: the request thread it counts, if it is one of the listed threads
  days_after_incident?: number | null; // for event: when the record gives the date as incident date plus N days
  date?: string | null;      // for event: ISO date if the record states one
};
export type RecordLane = { record: string; lane: Lane };

const FACT_SYSTEM = `You read records from a personal-injury law firm's case file and pull out facts. Every fact must carry a verbatim quote copied exactly from the record (at most 200 characters). Never paraphrase inside "quote". Do not invent anything.
Fact types:
- coverage: a statement about insurance coverage or policy limits. Put the per-person limit in "amount" if stated.
- amount: a money figure. Set "category": bills, lien, value, wage, offer, cost or other. Put the figure in "amount".
- count: how many of something (requests sent, visits, sessions, providers). Put the number in "count". If it counts requests in one of the listed threads, set "thread" to that slug.
- frequency: how often something happens.
- position: an account of fact that another record could contradict (how the incident happened, prior injuries, whether treatment ended, whether something was received).
- missing: the record says something exists or is needed but has not been obtained, requested, contacted or done.
- commitment: someone said they will do or send something.
- done: something was obtained, received, completed or served.
- injury: a body part with its diagnosis or finding.
- decision: a decision the responsible attorney still has to make.
- event: a real-world dated event (procedure, examination, filing, hearing). Give "date" (ISO) if stated, or "days_after_incident" if the record gives it as incident date plus N days.
"subject" is a short kebab-case slug saying what the fact is about, generic enough that two records about the same thing get the same slug.
Also classify each record into one lane: "medical", "legal", "money" or "communications".
Return only JSON: {"facts": [{"record": "...", "type": "...", "subject": "...", "quote": "..."}], "lanes": [{"record": "...", "lane": "..."}]}`;

export async function extractFacts(records: Rec[], threadSlugs: string[]): Promise<{ facts: RawFact[]; lanes: RecordLane[] }> {
  const body = `Known request threads: ${threadSlugs.join(", ") || "(none)"}\n\n` +
    records.map((r) => `### record ${r.resource}:${r.clioId}\nDate: ${r.date?.slice(0, 10) ?? "none"}\nTitle: ${r.title}\n${clip(r.text, 6000)}`).join("\n\n");
  const out = await chatJson<{ facts?: RawFact[]; lanes?: RecordLane[] }>("extract_facts", FACT_SYSTEM, body, MODEL_FAST);
  return { facts: out.facts ?? [], lanes: out.lanes ?? [] };
}

// ---- 3. Grouping: which facts disagree, which things are still not done ------------------------

export type Group = { label: string; fact_ids: number[] };

const CONFLICT_SYSTEM = `You are given facts from one case file, each with an id, a type, a subject, a date and a verbatim quote.
Find groups of facts that are about the same thing but state different things: different figures, different counts, different accounts of the same event, or a claim that a later fact contradicts.
Do not group facts that merely add detail or that agree. A changed running total over time is not a conflict unless the file treats both as current.
For each group give a short plain label of what they disagree about. The label must not contain numbers.
Return only a JSON array: [{"label": "...", "fact_ids": [1, 2]}]`;

const NOT_DONE_SYSTEM = `You are given facts from one case file, each with an id, a type, a subject, a date and a verbatim quote.
Types "missing" and "commitment" describe things not yet done or promised. Type "done" describes things completed or received.
List each distinct thing that is still not done as of the latest facts: drop anything a later "done" fact shows was completed.
Merge facts about the same thing into one entry. Give each a short plain label saying what has not been done. The label must not contain numbers.
Return only a JSON array: [{"label": "...", "fact_ids": [1, 2]}]`;

type FactLine = { id: number; type: string; subject: string | null; date: string | null; quote: string };
const lines = (facts: FactLine[]) => facts.map((f) => `[${f.id}] ${f.type} | ${f.subject ?? ""} | ${f.date?.slice(0, 10) ?? "undated"} | "${f.quote}"`).join("\n");

export const groupConflicts = (facts: FactLine[]) => (facts.length < 2 ? Promise.resolve([]) : chatJson<Group[]>("group_conflicts", CONFLICT_SYSTEM, lines(facts), MODEL));
export const groupNotDone = (facts: FactLine[]) => (facts.length ? chatJson<Group[]>("group_not_done", NOT_DONE_SYSTEM, lines(facts), MODEL) : Promise.resolve([]));

// ---- 4. Summary: two or three sentences, each tied to the items it rests on --------------------

export type SummarySentence = { text: string; item_ids: string[] };

const SUMMARY_SYSTEM = `You brief a senior attorney on where a case stands, in at most three plain sentences.
You are given the computed state of the file: open items, conflicts between records, things not yet done, and decisions waiting on the attorney. Each has an id.
Say what the case turns on, what is stuck and on whom, and what the attorney has to decide. Use only what is given.
Do not write any numbers, dates or amounts: the page shows those separately. No headings, no lists.
Return only a JSON array: [{"text": "...", "item_ids": ["..."]}] where item_ids are the ids the sentence rests on.`;

export const writeSummary = (state: string) => chatJson<SummarySentence[]>("write_summary", SUMMARY_SYSTEM, state, MODEL);
