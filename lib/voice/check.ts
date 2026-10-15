// Splits voice-agent output and checks claims against the sources it cites.
// agent.ts and tools.ts use these helpers before showing or saving a response.
// Source, unit and entity checks reject unsupported numeric claims.
// Deadline cleanup releases timers and listeners; callers cancel upstream work.
import { numbersIn } from "../pipeline/compute.ts";

/** "03" -> "3", "100000.50" -> "100000.5"; anything else unchanged. */
const normNum = (n: string) => (Number.isFinite(Number(n)) ? String(Number(n)) : n);

/** Keys whose numbers are internal ids, not facts the model may speak. */
const ID_KEYS = new Set(["id", "clioId", "nodeId", "sources", "source", "matterId", "photoDocumentId", "score"]);

/** Every number a tool result states, skipping ids and source markers. */
export function numbersFromData(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === "number") {
    out.add(normNum(String(v)));
  } else if (typeof v === "string") {
    for (const n of numbersIn(v)) out.add(normNum(n));
  } else if (Array.isArray(v)) {
    for (const x of v) numbersFromData(x, out);
  } else if (v && typeof v === "object") {
    for (const [key, value] of Object.entries(v)) {
      if (!ID_KEYS.has(key)) numbersFromData(value, out);
    }
  }
  return out;
}

/** Numbers in `text` that are not in `allowed`. Empty = the sentence may be shown and spoken. */
export function unsupported(text: string, allowed: Set<string>): string[] {
  return numbersIn(text).map(normNum).filter((n) => !allowed.has(n));
}

const CITE = /\s*\[\s*S?\d+(?:\s*[,;]\s*S?\d+)*\s*\]/g;

/** "Two limits differ [3][4]." -> { text: "Two limits differ.", cites: [3, 4] } */
export function extractCites(raw: string): { text: string; cites: number[] } {
  const cites: number[] = [];
  for (const m of raw.matchAll(CITE)) for (const d of m[0].match(/\d+/g) ?? []) if (!cites.includes(Number(d))) cites.push(Number(d));
  const text = raw.replace(CITE, "").replace(/\s+([.!?,;:])/g, "$1").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
  return { text, cites };
}

const ABBR = new Set(["dr", "mr", "mrs", "ms", "st", "vs", "inc", "no", "jr", "sr", "co", "ltd", "approx", "dept", "e.g", "i.e", "u.s", "p.m", "a.m"]);

/**
 * Takes the text streamed so far and returns the complete sentences plus the unfinished rest.
 * A sentence ends at . ! ? (plus any source markers or closing quotes after it) followed by whitespace,
 * or at a newline. Abbreviations and initials do not end a sentence.
 */
export function splitSentences(buf: string): { done: string[]; rest: string } {
  const done: string[] = [];
  let start = 0;
  const re = /([.!?])((?:["'”’)\]]|\s*\[\s*S?\d+(?:\s*[,;]\s*S?\d+)*\s*\])*)(\s+)|\n+/g;
  for (let m = re.exec(buf); m; m = re.exec(buf)) {
    if (m[1] === ".") {
      const word = buf.slice(start, m.index).split(/\s+/).at(-1)?.toLowerCase() ?? "";
      if (ABBR.has(word) || /^[a-z]$/.test(word)) continue;
    }
    const end = m.index + m[0].length - (m[3]?.length ?? m[0].length);
    const s = buf.slice(start, m[1] ? end : m.index).trim();
    if (s) done.push(s);
    start = m.index + m[0].length;
  }
  return { done, rest: buf.slice(start) };
}

// ---- Grounding: a number must come from the source the sentence cites, as the same kind of number, for the same party.
// The check above only asks whether a number appeared in any tool result. That lets "Lakeside was asked 3 times [1]"
// through when 3 is another provider's count, or "$3" when 3 was a count. The functions below bind each number to the
// cited evidence object, its unit and the party it is about.

export type Unit = "money" | "date" | "percent" | "days" | "weeks" | "months" | "years" | "count" | "plain";
export type Claim = { value: string; unit: Unit };
export type NumFact = { value: string; unit: Unit; key: string };
/** One object in a tool result that names its sources: the numbers it states and the parties it is about. */
export type EvidenceObj = { facts: NumFact[]; entities: string[]; stale: boolean };
export type Evidence = {
  bySource: Map<number, EvidenceObj[]>;
  /** Every party name seen in any tool result this conversation. */
  entities: Set<string>;
  /** Party names returned by a source-less lookup such as the provider directory. */
  unsourcedEntities: Set<string>;
  /** Numbers from tool results that carry no sources at all (for example the provider list); speakable uncited. */
  unsourced: Set<string>;
  /** How much the last search-style tool read, and how many scanned pages are still unread. */
  searched: { records: number; pages: number } | null;
  unreadPages: number;
};

export const newEvidence = (): Evidence => ({ bySource: new Map(), entities: new Set(), unsourcedEntities: new Set(), unsourced: new Set(), searched: null, unreadPages: 0 });

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const NAMED_DATE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
const NUM = /([+-]?\s*\$\s*|\$\s*[+-]?\s*|[+-]\s*)?(\d[\d,]*(?:\.\d+)?)(\s*(?:%|percent\b|days?\b|weeks?\b|months?\b|years?\b|times\b))?/gi;
const WORD = /\b([a-z]+)\b(\s+(?:days?|weeks?|months?|years?|times)\b)?/gi;

const unitFromSuffix = (s: string | undefined): Unit | null => {
  const w = (s ?? "").trim().toLowerCase();
  if (!w) return null;
  if (w === "%" || w === "percent") return "percent";
  // "asked 3 times" is a count: it may restate a count, never a number of days or an amount.
  if (w === "times") return "count";
  return (w.endsWith("s") ? w : `${w}s`) as Unit;
};

/** Every numeric claim in a sentence, with its unit. Dates are kept whole (2025-03-01), not split into 2025, 3 and 1. */
export function claimsIn(text: string): Claim[] {
  const out: Claim[] = [];
  let rest = text.replace(/−/g, "-").replace(ISO_DATE, (_m, y, mo, d) => { out.push({ value: `${y}-${mo}-${d}`, unit: "date" }); return " "; });
  rest = rest.replace(NAMED_DATE, (_m, mon: string, d: string, y: string) => {
    out.push({ value: `${y}-${String(MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${d.padStart(2, "0")}`, unit: "date" });
    return " ";
  });
  rest = rest.replace(NUM, (_m, prefix: string | undefined, n: string, suffix: string | undefined) => {
    const signed = `${prefix?.includes("-") ? "-" : ""}${n.replace(/,/g, "")}`;
    out.push({ value: normNum(signed), unit: prefix?.includes("$") ? "money" : unitFromSuffix(suffix) ?? "plain" });
    return " ";
  });
  for (const m of rest.matchAll(WORD)) {
    const [n] = numbersIn(m[1]);
    if (n) out.push({ value: normNum(n), unit: m[1].toLowerCase() === "twice" ? "count" : unitFromSuffix(m[2]) ?? "plain" });
  }
  return out;
}

const MONEY_KEY = /amount|balance|limit|total|spend|price|charge|cost|fee|lien|net|recovery|coverage/i;
const unitForKey = (key: string): Unit => (MONEY_KEY.test(key) ? "money" : /days/i.test(key) ? "days" : "plain");
/** Keys whose string value names the party a fact is about. */
const ENTITY_KEYS = new Set(["name", "waitingOn", "counterparty", "provider", "insurer", "carrier", "client", "entity", "patient", "from", "to"]);
const entityNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const claimKey = (c: Claim) => `${c.value}|${c.unit}`;

function factsFromString(s: string, key: string): NumFact[] {
  return claimsIn(s).map((c) => ({ ...c, key, unit: c.unit === "plain" && unitForKey(key) === "money" ? "money" : c.unit }));
}

const srcList = (o: Record<string, unknown>): number[] => {
  if (Array.isArray(o.sources)) return o.sources.filter((x): x is number => typeof x === "number");
  return typeof o.source === "number" ? [o.source] : [];
};

/**
 * Indexes a tool result as the model saw it (sources already replaced by numbers): which numbers and parties each
 * cited source supports. Objects with their own sources are separate evidence; plain nested values belong to the
 * nearest object above them that has sources. An array's `count` supports a claim citing any of its items.
 */
export function indexEvidence(result: unknown, ev: Evidence = newEvidence()): Evidence {
  const touched = new Set<number>();
  const attach = (obj: EvidenceObj, srcs: number[]) => {
    for (const n of srcs) {
      if (!touched.has(n)) { ev.bySource.set(n, []); touched.add(n); }
      ev.bySource.get(n)!.push(obj);
    }
  };
  const walk = (v: unknown, cur: EvidenceObj | null, key: string) => {
    if (Array.isArray(v)) { for (const x of v) walk(x, cur, key); return; }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const srcs = srcList(o);
      const here = srcs.length ? { facts: [], entities: [], stale: false } as EvidenceObj : cur;
      if (srcs.length) attach(here!, srcs);
      if (o.searched && typeof o.searched === "object") {
        const s = o.searched as { records?: number; pages?: number };
        ev.searched = { records: Number(s.records ?? 0), pages: Number(s.pages ?? 0) };
        ev.unreadPages = 0;
      }
      if (o.pagesRead && typeof o.pagesRead === "object") {
        const p = o.pagesRead as { done?: number; total?: number };
        ev.unreadPages = Math.max(0, Number(p.total ?? 0) - Number(p.done ?? 0));
      }
      // An array result: its count is an aggregate over the cited items.
      if (typeof o.count === "number" && Array.isArray(o.items)) {
        const itemSrcs = (o.items as unknown[]).flatMap((x) => (x && typeof x === "object" ? srcList(x as Record<string, unknown>) : []));
        if (itemSrcs.length) attach({ facts: [{ value: normNum(String(o.count)), unit: "plain", key: "count" }], entities: [], stale: false }, [...new Set(itemSrcs)]);
        else if (!here) ev.unsourced.add(normNum(String(o.count)));
      }
      if (here && (o.stale === true || o.status === "stale")) here.stale = true;
      for (const [k, x] of Object.entries(o)) {
        if (k === "sources" || k === "source" || k === "searched" || (k === "count" && Array.isArray(o.items))) continue;
        if (ID_KEYS.has(k)) continue;
        walk(x, here, k);
      }
      return;
    }
    if (typeof v === "number") {
      const f: NumFact = { value: normNum(String(v)), unit: unitForKey(key), key };
      if (cur) cur.facts.push(f); else ev.unsourced.add(f.value);
    } else if (typeof v === "string") {
      if (ENTITY_KEYS.has(key) && /[a-z]/i.test(v)) {
        const e = entityNorm(v);
        if (e.length >= 3) {
          ev.entities.add(e);
          if (cur) cur.entities.push(e);
          else ev.unsourcedEntities.add(e);
        }
      }
      const fs = factsFromString(v, key);
      if (cur) cur.facts.push(...fs); else for (const f of fs) ev.unsourced.add(f.value);
    }
  };
  walk(result, null, "");
  return ev;
}

/** A sentence unit and a fact unit agree. A bare number may restate any kind except a date. */
function compatible(said: Unit, fact: Unit): boolean {
  if (said === fact) return true;
  if (said === "plain") return fact !== "date";
  if (said === "count") return fact === "plain";
  return false;
}

const ABSENCE = /\b(not found|no record|no records|nothing (?:was |is )?(?:found|filed|recorded|on file)|none (?:was|were) found|there (?:is|are) no|has not been (?:found|filed|obtained)|was not (?:found|filed))\b/i;

export type GroundReason =
  | "invalid_citation" | "uncited_number" | "number_not_in_cited_source" | "number_from_uncited_source"
  | "unit_mismatch" | "entity_mismatch" | "entity_not_in_cited_source" | "uncited_entity" | "stale_source"
  | "absence_without_search" | "absence_with_unread_pages" | "ambiguous_entity";

/**
 * Whether a checked sentence (markers already removed, `cites` collected) is grounded in what it cites.
 * `user` holds claims from the attorney's own words and today's dates: those need no source.
 * Sentences without numbers or absence claims pass, provided their citations exist.
 */
export function ground(text: string, cites: number[], ev: Evidence, user: Set<string> = new Set()): { ok: boolean; reasons: { code: GroundReason; token?: string }[] } {
  const reasons: { code: GroundReason; token?: string }[] = [];
  for (const c of cites) if (!ev.bySource.has(c)) reasons.push({ code: "invalid_citation", token: String(c) });
  const absence = ABSENCE.test(text);
  const searchedNums = absence && ev.searched ? new Set([String(ev.searched.records), String(ev.searched.pages)]) : new Set<string>();
  const claims = claimsIn(text).filter((c) => !user.has(claimKey(c)) && !searchedNums.has(c.value));

  if (absence) {
    if (!ev.searched) reasons.push({ code: "absence_without_search" });
    else if (ev.unreadPages > 0 && !/\b(?:\d+|some|several|many)\s+(?:pages?\s+)?(?:remain(?:ing)?\s+unread|pages?\s+unread|not yet read)\b/i.test(text)) {
      reasons.push({ code: "absence_with_unread_pages" });
    }
  }
  const cited = cites.flatMap((c) => ev.bySource.get(c) ?? []);
  const all = [...ev.bySource.values()].flat();
  const said = entityNorm(text);
  const mentioned = [...ev.entities].filter((e) => said.includes(e));
  const citedEntities = new Set(cited.flatMap((o) => o.entities));
  if (cites.length) {
    for (const e of mentioned) if (!citedEntities.has(e)) reasons.push({ code: "entity_not_in_cited_source", token: e });
  } else {
    for (const e of mentioned) if (!ev.unsourcedEntities.has(e)) reasons.push({ code: "uncited_entity", token: e });
  }
  // Each numeric sentence must name at most one party; arbitrary prose cannot prove clause attribution.
  if (claims.length && mentioned.length > 1) reasons.push({ code: "ambiguous_entity" });
  if (!claims.length) return { ok: !reasons.length, reasons };
  if (!cites.length) {
    for (const c of claims) if (!ev.unsourced.has(c.value)) reasons.push({ code: "uncited_number", token: c.value });
    return { ok: !reasons.length, reasons };
  }

  for (const c of claims) {
    const has = (o: EvidenceObj) => o.facts.some((f) => f.value === c.value);
    const holders = cited.filter(has);
    if (!holders.length) {
      reasons.push({ code: all.some(has) ? "number_from_uncited_source" : "number_not_in_cited_source", token: c.value });
      continue;
    }
    const fit = holders.filter((o) => o.facts.some((f) => f.value === c.value && compatible(c.unit, f.unit)));
    if (!fit.length) { reasons.push({ code: "unit_mismatch", token: c.value }); continue; }
    if (mentioned.length) {
      const forParty = fit.filter((o) => o.entities.some((e) => mentioned.includes(e)));
      const neutral = fit.filter((o) => !o.entities.length);
      if (!forParty.length && !neutral.length) { reasons.push({ code: "entity_mismatch", token: c.value }); continue; }
    }
    if (fit.every((o) => o.stale)) reasons.push({ code: "stale_source", token: c.value });
  }
  return { ok: !reasons.length, reasons };
}

/** Checks a complete draft or message, preserving source markers while validating each sentence. */
export function groundText(body: string, ev: Evidence, user: Set<string> = new Set()): { ok: boolean; reasons: { code: GroundReason; token?: string }[] } {
  const { done, rest } = splitSentences(body);
  const reasons = [...done, rest].filter((s) => /[a-z0-9]/i.test(s)).flatMap((raw) => {
    const { text, cites } = extractCites(raw);
    return ground(text, cites, ev, user).reasons;
  });
  const unique = [...new Map(reasons.map((r) => [`${r.code}|${r.token ?? ""}`, r])).values()];
  return { ok: unique.length === 0, reasons: unique };
}

/** Typed claims from the attorney's own words (and dates in the prompt) may be repeated without a source. */
export function userClaims(texts: string[], into: Set<string> = new Set()): Set<string> {
  for (const t of texts) for (const c of claimsIn(t)) into.add(claimKey(c));
  return into;
}

/**
 * Streamed text in, complete sentences out. `flush` gives the unfinished tail when the stream ended normally;
 * after an abort the caller simply never flushes, so half a sentence is never checked, shown or spoken.
 */
export class SentenceStream {
  private buf = "";
  push(delta: string): string[] {
    this.buf += delta;
    const { done, rest } = splitSentences(this.buf);
    this.buf = rest;
    return done;
  }
  flush(): string[] {
    const s = this.buf.trim();
    this.buf = "";
    return s ? [s] : [];
  }
}

export class DeadlineError extends Error {}

/** Resolves like `p`, or rejects with DeadlineError after `ms`, or rejects at once if `signal` aborts. */
export function withDeadline<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      // Observe work already started by the caller, even when cancellation wins.
      void p.catch(() => {});
      return reject(new DeadlineError("aborted"));
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DeadlineError("aborted"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new DeadlineError(`timed out after ${ms} ms`));
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => { cleanup(); resolve(v); },
      (e) => { cleanup(); reject(e); },
    );
  });
}
