// Owner: Tijil. Pure functions: every count, date and amount shown or spoken is computed here,
// never written by a model. No database or network imports, so tests run these directly.
import type { OpenItem, Party, SourceRef } from "../contracts";

// ---- Text checks -------------------------------------------------------------

export const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** True when `quote` appears verbatim in `source`, ignoring case, spacing and curly quotes. */
export function quoteFound(quote: string, source: string): boolean {
  const q = norm(quote);
  return q.length > 0 && norm(source).includes(q);
}

const WORDS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60",
  seventy: "70", eighty: "80", ninety: "90", twice: "2",
};

/** Every number in `text`, as digit strings: "1,410.00" -> "1410", "five" -> "5". */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(m[0].replace(/,/g, "").replace(/\.0+$/, ""));
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) if (WORDS[w]) out.push(WORDS[w]);
  return out;
}

/**
 * Numbers in `text` that do not appear anywhere in `allowed` (tool results, source quotes).
 * A sentence with any unsupported number must not be shown or spoken.
 * ponytail: "one" is not treated as a number (too common as a pronoun); add it if false passes show up.
 */
export function unsupportedNumbers(text: string, allowed: string[]): string[] {
  const ok = new Set(allowed.flatMap(numbersIn));
  return numbersIn(text).filter((n) => !ok.has(n));
}

// ---- Dates -------------------------------------------------------------------

const DAY = 86_400_000;
const day = (iso: string) => new Date(iso.slice(0, 10) + "T00:00:00Z").getTime();

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((day(toIso) - day(fromIso)) / DAY);
}

export function addDays(iso: string, n: number): string {
  return new Date(day(iso) + n * DAY).toISOString().slice(0, 10);
}

/** Finds "DOI + 94" style references (date of incident plus N days) and gives the real date. */
export function resolveRelativeDates(text: string, incidentDate: string): { match: string; date: string }[] {
  return [...text.matchAll(/\bDOI\s*\+\s*(\d+)/gi)].map((m) => ({ match: m[0], date: addDays(incidentDate, Number(m[1])) }));
}

// ---- Money -------------------------------------------------------------------

export type NetInput = { label: string; amount: number };

/** recovery - fee - costs - liens, with every input listed so the page can show the arithmetic. */
export function netToClient(recovery: number, feeFraction: number, costs: number, liens: NetInput[]) {
  const fee = Math.round(recovery * feeFraction);
  const inputs: NetInput[] = [
    { label: "recovery", amount: recovery },
    { label: "fee", amount: fee },
    { label: "firm spend", amount: costs },
    ...liens,
  ];
  const amount = Math.round(recovery - fee - costs - liens.reduce((s, l) => s + l.amount, 0));
  return { amount, formula: ["recovery", "fee", "firm spend", ...liens.map((l) => l.label)].join(" - "), inputs };
}

// ---- Open items --------------------------------------------------------------

export type CommIn = {
  clioId: number; date: string; subject: string;
  direction: "out" | "in"; counterparty: string;
  thread: string; kind: "request" | "reply" | "info"; resolves: boolean; party: Party;
};
export type TaskIn = {
  clioId: number; name: string; due: string | null; done: boolean;
  thread: string | null; party: Party; waitingOn: string;
};
export type CountIn = { thread: string; value: number; source: SourceRef };
export type ReplyIn = { requestId: string; reply: string; replyDate: string | null; at: string };

/**
 * One row per thing still outstanding. For each thread of messages: count the firm's requests
 * since the last reply that resolved it. A thread with no unresolved request and no pending task is closed.
 */
export function computeOpenItems(input: { comms: CommIn[]; tasks: TaskIn[]; counts: CountIn[]; replies: ReplyIn[]; today: string }): OpenItem[] {
  const { today } = input;
  const items = new Map<string, OpenItem>();

  const threads = new Map<string, CommIn[]>();
  for (const c of input.comms) (threads.get(c.thread) ?? threads.set(c.thread, []).get(c.thread)!).push(c);

  for (const [thread, list] of threads) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let asks: CommIn[] = [];
    for (const c of list) {
      if (c.direction === "out" && c.kind === "request") asks.push(c);
      else if (c.direction === "in" && c.resolves) asks = [];
    }
    if (!asks.length) continue;
    const first = asks[0], last = asks[asks.length - 1];
    items.set(thread, {
      id: `open-${thread}`, what: last.subject, waitingOn: last.counterparty, party: last.party,
      asks: asks.length, daysOpen: daysBetween(first.date, today), firstAsked: first.date.slice(0, 10), lastAsked: last.date.slice(0, 10),
      otherCounts: [], providerReply: null,
      sources: asks.map((a) => ({ resource: "communications", clioId: a.clioId })),
    });
  }

  for (const t of input.tasks.filter((t) => !t.done)) {
    const ref: SourceRef = { resource: "tasks", clioId: t.clioId };
    const existing = t.thread ? items.get(t.thread) : undefined;
    if (existing) { existing.sources.push(ref); continue; }
    const key = t.thread ?? `task-${t.clioId}`;
    const since = t.due ?? today;
    items.set(key, {
      id: `open-${key}`, what: t.name, waitingOn: t.waitingOn, party: t.party,
      asks: 0, daysOpen: Math.max(0, daysBetween(since, today)), firstAsked: since.slice(0, 10), lastAsked: since.slice(0, 10),
      otherCounts: [], providerReply: null, sources: [ref],
    });
  }

  // Counts stated elsewhere in the file that disagree with what we counted: show them, do not pick one.
  for (const c of input.counts) {
    const it = items.get(c.thread);
    if (it && c.value !== it.asks) it.otherCounts.push({ value: c.value, sources: [c.source] });
  }

  return attachReplies([...items.values()].sort((a, b) => b.daysOpen - a.daysOpen), input.replies);
}

/** Puts each provider's latest one-click reply on the open item it answers (contract E). */
export function attachReplies(items: OpenItem[], replies: ReplyIn[]): OpenItem[] {
  const latest = new Map<string, ReplyIn>();
  for (const r of replies) if (!latest.has(r.requestId) || latest.get(r.requestId)!.at < r.at) latest.set(r.requestId, r);
  for (const it of items) {
    const r = latest.get(it.id);
    if (r) it.providerReply = { reply: r.reply, replyDate: r.replyDate, at: r.at };
  }
  return items;
}
