// Owner: Laksh. The voice agent's tools: contract A plus page control and drafts. The model learns about the
// case only through these. Every source in a result is replaced by a short number the model cites as [n].
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { SectionName, SourceRef } from "../contracts";
import { q } from "../db";
import { tools } from "../tools";
import { extractCites, numbersFromData, splitSentences, unsupported } from "./check";
import { imessageTarget, sendIMessage } from "./imessage";

export type Registry = { refs: SourceRef[]; section: (SectionName | null)[] };

/** What a tool call did besides returning data: things the browser must do. */
export type Action =
  | { type: "show"; section?: SectionName; source?: SourceRef }
  | { type: "replay"; from?: string; to?: string }
  | { type: "draft"; draft: { id: number; kind: string; recipient: string | null; body: string; at: string } }
  | { type: "sent"; channel: "imessage"; to: string; body: string };

const fn = (name: string, description: string, properties: Record<string, object> = {}, required: string[] = []): ChatCompletionTool => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

export const TOOL_DEFS: ChatCompletionTool[] = [
  fn("get_summary", "Header facts (client, stage, last client contact, limitations entry, firm spend, pages read) and the checked summary sentences."),
  fn("get_open_items", "Requests the firm is waiting on: who, how many asks, days open, other counts in the file, and any provider reply."),
  fn("get_conflicts", "Places where the file disagrees with itself. Each version with its source."),
  fn("get_money", "Coverage, bills, liens, firm spend and the rough net to client with its formula and inputs."),
  fn("get_not_done", "Things the file says exist or should happen with no later record that they did."),
  fn("get_changes", "Records dated after a day.", { since: { type: "string", description: "YYYY-MM-DD" } }, ["since"]),
  fn("search_records", "Keyword search over every record and scanned page.", { query: { type: "string" } }, ["query"]),
  fn("get_related", "A person, provider or insurer and how it links to others in the case.", { entity: { type: "string" } }, ["entity"]),
  fn("get_record", "Full text of one record, by the source number shown in an earlier result.", { source: { type: "integer" } }, ["source"]),
  fn("list_providers", "Treating providers on this case."),
  fn("get_timeline", "Dated events in four lanes (medical, legal, money, communications)."),
  fn("show", "Scroll the firm page to a section and/or open a source with its quote highlighted.", {
    section: { type: "string", enum: ["summary", "conflicts", "money", "open_items", "not_done", "top_ten", "changes"] },
    source: { type: "integer", description: "A source number from an earlier result" },
  }),
  fn("play_replay", "Play the animated case replay on the page, optionally between two dates.", {
    from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" },
  }),
  fn("create_draft", "Save a draft for the attorney to review. Never sent, never written to Clio. Only when asked.", {
    kind: { type: "string", enum: ["email", "todo", "provider_update"] },
    to: { type: "string", description: "Recipient name or role" },
    body: { type: "string" },
  }, ["kind", "body"]),
  fn("send_imessage", "Text a short case summary to the attorney's own phone by iMessage. Only when the attorney asks for it in this message. The recipient is fixed; you cannot choose it.", {
    body: { type: "string", description: "Plain sentences built only from tool results, with [n] source markers. No markdown." },
  }, ["body"]),
];

/** Which page section a tool's facts live in, so the page can follow the answer. */
const SECTION: Record<string, SectionName> = {
  get_summary: "summary", get_open_items: "open_items", get_conflicts: "conflicts", get_money: "money",
  get_not_done: "not_done", get_changes: "changes",
};

const key = (r: SourceRef) => `${r.resource}:${r.clioId}:${r.pageNo ?? ""}:${r.quote ?? ""}`;

function cite(reg: Registry, r: SourceRef, section: SectionName | null): number {
  const k = key(r);
  const i = reg.refs.findIndex((x) => key(x) === k);
  if (i >= 0) return i + 1;
  reg.refs.push(r);
  reg.section.push(section);
  return reg.refs.length;
}

const isRef = (v: unknown): v is SourceRef => !!v && typeof v === "object" && "resource" in v && "clioId" in v;

/** Replace every SourceRef with its number, and add counts to arrays so the model never counts. */
function forModel(v: unknown, reg: Registry, section: SectionName | null): unknown {
  if (Array.isArray(v)) return v.map((x) => forModel(x, reg, section));
  if (isRef(v)) return { source: cite(reg, v, section), ...(v.quote ? { quote: v.quote } : {}) };
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "sources" && Array.isArray(x)) out.sources = x.filter(isRef).map((r) => cite(reg, r, section));
      else if (k === "source" && isRef(x)) out.source = cite(reg, x, section);
      else out[k] = forModel(x, reg, section);
    }
    return out;
  }
  return v;
}

/** A ToolResult becomes { count, items | data, searched } with numbered sources. */
function shape(name: string, res: unknown, reg: Registry) {
  const section = SECTION[name] ?? null;
  const r = res as { data?: unknown; searched?: unknown };
  const data = r && typeof r === "object" && "data" in r ? r.data : res;
  const body = Array.isArray(data) ? { count: data.length, items: forModel(data, reg, section) } : { data: forModel(data, reg, section) };
  return { ...body, ...(r && typeof r === "object" && "searched" in r ? { searched: r.searched } : {}) };
}

/** `userMessage` is what the attorney said this turn: the iMessage tool only runs when they asked for a text. */
export type ToolCtx = { matterId: number; userId: number; reg: Registry; allowed: Set<string>; userMessage: string };

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<{ result: unknown; actions: Action[] }> {
  const { matterId, reg } = ctx;
  const ref = (n: unknown) => reg.refs[Number(n) - 1];
  switch (name) {
    case "get_summary": return { result: shape(name, await tools.getSummary(matterId), reg), actions: [] };
    case "get_open_items": return { result: shape(name, await tools.getOpenItems(matterId), reg), actions: [] };
    case "get_conflicts": return { result: shape(name, await tools.getConflicts(matterId), reg), actions: [] };
    case "get_money": return { result: shape(name, await tools.getMoney(matterId), reg), actions: [] };
    case "get_not_done": return { result: shape(name, await tools.getNotDone(matterId), reg), actions: [] };
    case "get_changes": return { result: shape(name, await tools.getChanges(matterId, String(args.since ?? "1900-01-01")), reg), actions: [] };
    case "search_records": return { result: shape(name, await tools.searchRecords(matterId, String(args.query ?? "")), reg), actions: [] };
    case "get_related": return { result: shape(name, await tools.getRelated(matterId, String(args.entity ?? "")), reg), actions: [] };
    case "list_providers": {
      const ps = await tools.listProviders(matterId);
      return { result: { count: ps.length, items: ps.map((p) => ({ name: p.name, role: p.role })) }, actions: [] };
    }
    case "get_timeline": return { result: shape(name, await tools.getTimeline(matterId), reg), actions: [] };
    case "get_record": {
      const r = ref(args.source);
      if (!r) return { result: { error: "No such source number" }, actions: [] };
      const d = await tools.getRecord(r);
      if (!d) return { result: { error: "Record not found" }, actions: [] };
      return { result: { source: Number(args.source), title: d.title, date: d.date, text: d.text.slice(0, 6000) }, actions: [{ type: "show", source: r }] };
    }
    case "show": {
      const section = typeof args.section === "string" ? (args.section as SectionName) : undefined;
      const source = args.source !== undefined ? ref(args.source) : undefined;
      if (!section && !source) return { result: { error: "Give a section or a source number" }, actions: [] };
      return { result: { ok: true }, actions: [{ type: "show", section, source }] };
    }
    case "play_replay": {
      const d = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
      return { result: { ok: true }, actions: [{ type: "replay", from: d(args.from), to: d(args.to) }] };
    }
    case "create_draft": {
      const body = String(args.body ?? "").trim();
      if (!body) return { result: { error: "Empty draft" }, actions: [] };
      // Drafts follow the same number rule as speech.
      const bad = unsupported(body, ctx.allowed);
      if (bad.length) return { result: { error: `Draft not saved: it has numbers no tool returned (${bad.join(", ")}). Remove them or look them up first.` }, actions: [] };
      const kind = ["email", "todo", "provider_update"].includes(String(args.kind)) ? String(args.kind) : "email";
      const to = args.to ? String(args.to).slice(0, 200) : null;
      const [row] = await q<{ id: string; at: Date }>(
        "INSERT INTO drafts (matter_id, kind, recipient, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, at",
        [matterId, kind, to, body.slice(0, 8000), ctx.userId],
      );
      return {
        result: { ok: true, saved: "draft saved for review; not sent" },
        actions: [{ type: "draft", draft: { id: Number(row.id), kind, recipient: to, body, at: row.at.toISOString() } }],
      };
    }
    case "send_imessage": {
      // Record text can contain instructions; only the attorney's own words this turn can trigger a send.
      if (!/\b(i ?message|text|message|send|phone)\b/i.test(ctx.userMessage)) {
        return { result: { error: "Not sent: the attorney did not ask for a text in this message." }, actions: [] };
      }
      if (!imessageTarget()) return { result: { error: "Not sent: no iMessage number is set up (IMESSAGE_TO)." }, actions: [] };
      // Same checks as speech: markers removed, and no number a tool did not return.
      const { done, rest } = splitSentences(String(args.body ?? ""));
      const text = [...done, rest].map((x) => extractCites(x).text).filter((x) => /[a-z0-9]/i.test(x)).join(" ").slice(0, 2000);
      if (!text) return { result: { error: "Empty message" }, actions: [] };
      const bad = unsupported(text, ctx.allowed);
      if (bad.length) return { result: { error: `Not sent: it has numbers no tool returned (${bad.join(", ")}). Remove them or look them up first.` }, actions: [] };
      const r = await sendIMessage(text);
      if (!r.ok) return { result: { error: `Not sent: ${r.error}` }, actions: [] };
      await q("INSERT INTO outbox (matter_id, reason, recipient, subject, body) VALUES ($1,'imessage',$2,'Case summary by iMessage',$3)", [matterId, r.to, text]).catch(() => {});
      return { result: { ok: true, sent: "texted to the attorney's phone" }, actions: [{ type: "sent", channel: "imessage", to: r.to, body: text }] };
    }
    default:
      return { result: { error: `Unknown tool ${name}` }, actions: [] };
  }
}

/** Numbers a tool result makes speakable. */
export const allowFrom = (result: unknown, allowed: Set<string>) => numbersFromData(result, allowed);
