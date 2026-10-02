// Owner: Tijil. Contract A on real data. Reads the sections cached by lib/pipeline/process.ts,
// so opening a case costs no model calls.
import { q } from "../db";
import type {
  CaseTools, Change, Conflict, Money, NotDone, OpenItem, Provider, RecordDetail, Related,
  SearchHit, Shareable, SourceRef, Sourced, Summary, TimelineEvent, ToolResult,
} from "../contracts";
import { attachReplies } from "../pipeline/compute";
import { readSection } from "../pipeline/process";
import { customFieldRecords, loadMatter, loadRecords } from "../pipeline/records";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** How much was actually read, so "not found" can say what was searched. */
async function searched(matterId: number) {
  const [r] = await q<{ records: string }>("SELECT count(*) AS records FROM raw_records WHERE matter_id = $1", [matterId]);
  const [p] = await q<{ pages: string }>(
    "SELECT count(*) AS pages FROM scan_pages WHERE status = 'done' AND document_id IN (SELECT clio_id FROM raw_records WHERE matter_id = $1 AND resource = 'documents')",
    [matterId],
  );
  return { records: Number(r?.records ?? 0), pages: Number(p?.pages ?? 0) };
}

const uniq = (refs: SourceRef[]) => [...new Map(refs.map((r) => [`${r.resource}:${r.clioId}:${r.pageNo ?? ""}:${r.quote ?? ""}`, r])).values()];

async function wrap<T>(matterId: number, data: T, sources: SourceRef[]): Promise<ToolResult<T>> {
  return { data, sources: uniq(sources), searched: await searched(matterId) };
}

async function section<T extends Sourced<object>>(matterId: number, name: string): Promise<ToolResult<T[]>> {
  const data = (await readSection<T[]>(matterId, name)) ?? [];
  return wrap(matterId, data, data.flatMap((d) => d.sources));
}

const EMPTY_SUMMARY: Summary = {
  header: { clientName: "", photoDocumentId: null, stage: null, lastClientContact: null, limitations: null, firmSpend: { amount: 0, sources: [] }, pagesRead: { done: 0, total: 0 } },
  sentences: [],
};

async function openItems(matterId: number): Promise<OpenItem[]> {
  const items = (await readSection<OpenItem[]>(matterId, "open_items")) ?? [];
  // Contract E: provider replies arrive through the database, written by the provider portal.
  const replies = await q<any>(
    `SELECT r.request_id, r.reply, r.reply_date, r.at FROM provider_replies r
     JOIN shared_items s ON s.id = r.shared_item_id WHERE s.matter_id = $1`,
    [matterId],
  ).catch(() => []);
  return attachReplies(items, replies.map((r) => ({
    requestId: r.request_id, reply: r.reply,
    replyDate: r.reply_date ? new Date(r.reply_date).toISOString().slice(0, 10) : null,
    at: new Date(r.at).toISOString(),
  })));
}

export const liveTools: CaseTools = {
  async listMatters() {
    const rows = await q<{ clio_id: string; data: any }>("SELECT clio_id, data FROM raw_records WHERE resource = 'matters' ORDER BY clio_id");
    return rows.map((r) => ({
      id: Number(r.clio_id), name: String(r.data.description ?? r.data.display_number ?? r.clio_id),
      client: String(r.data.client?.name ?? ""), stage: r.data.matter_stage?.name ?? null, status: r.data.status ?? null,
    }));
  },

  async listProviders(matterId) {
    const rows = await q<any>("SELECT id, name, props FROM nodes WHERE matter_id = $1 AND type = 'provider' ORDER BY name", [matterId]);
    return rows.map((n): Provider => ({ nodeId: Number(n.id), name: n.name, email: n.props?.email ?? null, role: n.props?.relationship ?? null }));
  },

  async getSummary(matterId) {
    const s = (await readSection<Summary>(matterId, "summary")) ?? EMPTY_SUMMARY;
    return wrap(matterId, s, s.sentences.flatMap((x) => x.sources));
  },

  async getOpenItems(matterId) {
    const items = await openItems(matterId);
    return wrap(matterId, items, items.flatMap((i) => i.sources));
  },

  async getConflicts(matterId) {
    const data = (await readSection<Conflict[]>(matterId, "conflicts")) ?? [];
    return wrap(matterId, data, data.flatMap((c) => c.versions.flatMap((v) => v.sources)));
  },

  async getMoney(matterId) {
    const data = (await readSection<Money>(matterId, "money")) ?? { lines: [], netToClient: { amount: null, formula: "", inputs: [], assumption: "" } };
    return wrap(matterId, data, data.lines.flatMap((l) => l.sources));
  },

  getNotDone: (matterId) => section<NotDone>(matterId, "not_done"),

  async getChanges(matterId, since) {
    // Diffed on each record's own date: every Clio record may have been created on the same day.
    const recs = (await loadRecords(matterId, ["notes", "communications", "tasks", "calendar_entries", "activities", "documents"]))
      .filter((r) => r.date && r.date.slice(0, 10) > since.slice(0, 10) && r.date.slice(0, 10) <= new Date().toISOString().slice(0, 10));
    const data: Change[] = recs.reverse().map((r) => ({ date: r.date!.slice(0, 10), kind: r.resource, title: r.title, sources: [{ resource: r.resource, clioId: r.clioId }] }));
    return wrap(matterId, data, data.flatMap((d) => d.sources));
  },

  async searchRecords(matterId, query) {
    // ponytail: keyword search only; add the embedding half (reciprocal-rank merge) when an embedding key is configured.
    const rows = await q<any>(
      `SELECT resource, clio_id, page_no, title, ts_rank(tsv, query) AS score,
              ts_headline('english', body, query, 'MaxWords=30, MinWords=10') AS snippet
       FROM search_index, websearch_to_tsquery('english', $2) query
       WHERE matter_id = $1 AND tsv @@ query ORDER BY score DESC LIMIT 8`,
      [matterId, query],
    );
    const data: SearchHit[] = rows.map((r) => ({
      title: r.title ?? "", snippet: String(r.snippet).replace(/<\/?b>/g, ""), score: Number(r.score),
      source: { resource: r.resource, clioId: Number(r.clio_id), ...(Number(r.page_no) ? { pageNo: Number(r.page_no) } : {}) },
    }));
    return wrap(matterId, data, data.map((d) => d.source));
  },

  async getRelated(matterId, entity) {
    const [node] = await q<any>(
      "SELECT id, type, name FROM nodes WHERE matter_id = $1 AND norm_name LIKE '%' || $2 || '%' ORDER BY length(name) LIMIT 1",
      [matterId, entity.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()],
    );
    if (!node) return wrap(matterId, { node: null, links: [] } as Related, []);
    const links = await q<any>(
      `SELECT e.type, e.resource, e.clio_id, e.quote, n.id, n.type AS ntype, n.name
       FROM edges e JOIN nodes n ON n.id = CASE WHEN e.src = $1 THEN e.dst ELSE e.src END
       WHERE e.src = $1 OR e.dst = $1`,
      [node.id],
    );
    const data: Related = {
      node: { id: Number(node.id), type: node.type, name: node.name },
      links: links.map((l) => ({
        type: l.type, other: { id: Number(l.id), type: l.ntype, name: l.name },
        source: l.resource ? { resource: l.resource, clioId: Number(l.clio_id), quote: l.quote ?? undefined } : null,
      })),
    };
    return wrap(matterId, data, data.links.flatMap((l) => (l.source ? [l.source] : [])));
  },

  async getRecord(ref) {
    if (ref.resource === "scan_pages" || ref.pageNo) {
      const [p] = await q<any>("SELECT text FROM scan_pages WHERE document_id = $1 AND page_no = $2", [ref.clioId, ref.pageNo ?? 1]);
      return p ? { resource: ref.resource, clioId: ref.clioId, pageNo: ref.pageNo, title: `Page ${ref.pageNo}`, date: null, text: p.text ?? "" } : null;
    }
    if (ref.resource === "custom_fields") {
      const [m] = await q<{ data: any }>("SELECT data FROM raw_records WHERE resource = 'matters' AND data->'custom_field_values' IS NOT NULL");
      const f = customFieldRecords(m?.data).find((x) => x.clioId === ref.clioId);
      return f ? { resource: f.resource, clioId: f.clioId, title: f.title, date: null, text: f.text } : null;
    }
    const [row] = await q<{ matter_id: string }>("SELECT matter_id FROM raw_records WHERE resource = $1 AND clio_id = $2", [ref.resource, ref.clioId]);
    if (!row) return null;
    const rec = (await loadRecords(Number(row.matter_id), [ref.resource])).find((r) => r.clioId === ref.clioId);
    return rec ? ({ resource: rec.resource, clioId: rec.clioId, title: rec.title, date: rec.date?.slice(0, 10) ?? null, text: rec.text } satisfies RecordDetail) : null;
  },

  getTimeline: (matterId) => section<TimelineEvent>(matterId, "timeline"),

  async getShareable(matterId, providerNodeId): Promise<Shareable> {
    const matter = await loadMatter(matterId);
    const providers = await liveTools.listProviders(matterId);
    const me = providers.find((p) => p.nodeId === providerNodeId);
    const words = (me?.name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    // Loose match: a request belongs to this provider if the party it waits on shares a distinctive word with the provider's name.
    const mine = (text: string) => words.some((w) => text.toLowerCase().includes(w));
    const requests = (await openItems(matterId)).filter((o) => o.party === "provider" && mine(o.waitingOn));
    const money = (await liveTools.getMoney(matterId)).data;
    const coverage = money.lines.filter((l) => l.label === "Coverage limit");
    return {
      stage: { label: "Case stage", payload: { stage: matter?.matter_stage?.name ?? null, status: matter?.status ?? null }, sources: [] },
      requests: {
        label: "What the firm needs from you",
        payload: requests.map((o) => ({ id: o.id, what: o.what, asks: o.asks, firstAsked: o.firstAsked, lastAsked: o.lastAsked })),
        sources: requests.flatMap((o) => o.sources),
      },
      // Charges read from the scanned documents, on pages that name this provider. Empty until the scan job has run.
      own_bills: await (async () => {
        const rows = await q<any>(
          "SELECT value, quote, clio_id, page_no FROM facts WHERE matter_id = $1 AND resource = 'documents' AND type = 'amount' AND value->>'category' = 'bills'",
          [matterId],
        );
        const bills = rows.filter((r) => mine(String(r.value?.provider ?? "")));
        return {
          label: "Your bills as the firm holds them",
          payload: bills.map((r) => ({ description: r.value.description ?? null, amount: r.value.amount })),
          sources: bills.map((r): SourceRef => ({ resource: "documents", clioId: Number(r.clio_id), pageNo: Number(r.page_no), quote: r.quote })),
        };
      })(),
      coverage: { label: "Insurance coverage", payload: coverage.map((c) => ({ amount: c.amount, basis: c.foundation })), sources: coverage.flatMap((c) => c.sources) },
      other_treaters: { label: "Other treating providers", payload: providers.filter((p) => p.nodeId !== providerNodeId).map((p) => ({ role: p.role })), sources: [] },
    };
  },
};
