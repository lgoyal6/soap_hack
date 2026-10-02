// Owner: Laksh. Pure functions for the voice agent: split streamed text into sentences, pull out source
// markers, and drop any sentence with a number that no tool returned (trust rule 1). No server imports.
import { numbersIn } from "../pipeline/compute.ts";

/** "03" -> "3", "100000.50" -> "100000.5"; anything else unchanged. */
const normNum = (n: string) => (Number.isFinite(Number(n)) ? String(Number(n)) : n);

/** Keys whose numbers are internal ids, not facts the model may speak. */
const ID_KEYS = new Set(["id", "clioId", "nodeId", "sources", "source", "matterId", "photoDocumentId", "score"]);

/** Every number a tool result states, skipping ids and source markers. */
export function numbersFromData(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === "number") out.add(normNum(String(v)));
  else if (typeof v === "string") for (const n of numbersIn(v)) out.add(normNum(n));
  else if (Array.isArray(v)) for (const x of v) numbersFromData(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!ID_KEYS.has(k)) numbersFromData(x, out);
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
