// Owner: Tijil. A MADE-UP case used until the real pipeline is wired, and by tests.
// Nothing here comes from a real matter. Shapes follow lib/contracts.ts.
import type {
  CaseTools, Change, Conflict, Matter, Money, NotDone, OpenItem, Provider, RecordDetail,
  Related, SearchHit, Shareable, SourceRef, Summary, TimelineEvent, ToolResult,
} from "@/lib/contracts";

const MATTER: Matter = { id: 1, name: "Okafor, Dana - Rear-end collision", client: "Dana Okafor", stage: "Treatment", status: "Open" };

const RECORDS: RecordDetail[] = [
  { resource: "notes", clioId: 101, title: "Intake summary", date: "2025-02-03", text: "Client was stopped at a light when a delivery van struck her from behind. Complains of neck and lower back pain. Adjuster says the van carries a 250,000 policy." },
  { resource: "notes", clioId: 102, title: "Coverage letter received", date: "2025-06-10", text: "Carrier letter states bodily injury limit of 100,000 per person. This differs from what the adjuster told us at intake." },
  { resource: "communications", clioId: 201, title: "Records request: physical therapy file", date: "2025-03-01", text: "Please provide the complete physical therapy file including itemised billing." },
  { resource: "communications", clioId: 202, title: "Second request: physical therapy file", date: "2025-04-15", text: "We have not received the file requested on March 1. Please advise." },
  { resource: "communications", clioId: 203, title: "Call with client", date: "2025-07-02", text: "Client says she has dashcam footage of the collision and will send it. Still attending therapy weekly." },
  { resource: "tasks", clioId: 301, title: "By medical provider: Lakeside Physical Therapy - updated ledger", date: "2025-05-01", text: "Itemised ledger needed. One request sent." },
  { resource: "activities", clioId: 401, title: "Records copy fee", date: "2025-03-20", text: "Records reproduction, paid by the firm." },
];

const src = (clioId: number, quote?: string): SourceRef => {
  const r = RECORDS.find((x) => x.clioId === clioId)!;
  return { resource: r.resource, clioId, quote };
};
const wrap = <T>(data: T, sources: SourceRef[]): ToolResult<T> => ({ data, sources, searched: { records: RECORDS.length, pages: 0 } });

const PROVIDERS: Provider[] = [
  { nodeId: 1, name: "Lakeside Physical Therapy", email: "records@lakesidept.test", role: "Treating provider, physical therapy" },
  { nodeId: 2, name: "Dr. Imani Reyes", email: "ireyes@harborortho.test", role: "Treating orthopaedist" },
];

const SUMMARY: Summary = {
  header: {
    clientName: MATTER.client,
    photoDocumentId: null,
    stage: MATTER.stage,
    lastClientContact: { date: "2025-07-02", sources: [src(203)] },
    limitations: null,
    firmSpend: { amount: 45, sources: [src(401)] },
    pagesRead: { done: 0, total: 0 },
  },
  sentences: [
    { text: "The file gives two different coverage limits and the lower one is the one in writing.", sources: [src(101, "250,000 policy"), src(102, "100,000 per person")] },
    { text: "The physical therapy file has been requested more than once and has not arrived.", sources: [src(201), src(202)] },
  ],
};

const OPEN_ITEMS: OpenItem[] = [
  {
    id: "open-1", what: "Physical therapy file and itemised billing", waitingOn: "Lakeside Physical Therapy", party: "provider",
    asks: 2, daysOpen: 120, firstAsked: "2025-03-01", lastAsked: "2025-04-15",
    otherCounts: [{ value: 1, sources: [src(301, "One request sent")] }],
    providerReply: null, sources: [src(201), src(202)],
  },
];

const CONFLICTS: Conflict[] = [
  {
    id: "conflict-1", topic: "Bodily injury coverage limit",
    versions: [
      { value: "250,000", date: "2025-02-03", sources: [src(101, "250,000 policy")] },
      { value: "100,000 per person", date: "2025-06-10", sources: [src(102, "100,000 per person")] },
    ],
  },
];

const MONEY: Money = {
  lines: [
    { label: "Coverage (in writing)", amount: 100000, foundation: "carrier letter", sources: [src(102, "100,000 per person")] },
    { label: "Firm spend", amount: 45, foundation: "sum of expense entries", sources: [src(401)] },
  ],
  netToClient: {
    amount: 66622,
    formula: "coverage - fee - firm spend",
    inputs: [{ label: "coverage", amount: 100000 }, { label: "fee", amount: 33333 }, { label: "firm spend", amount: 45 }],
    assumption: "Fee is an assumed one third; it is not in the file. Illustrative at policy limits.",
  },
};

const NOT_DONE: NotDone[] = [
  { id: "nd-1", what: "Dashcam footage the client said she would send", since: "2025-07-02", daysOpen: 30, sources: [src(203, "dashcam footage")] },
];

const TIMELINE: TimelineEvent[] = RECORDS.map((r) => ({
  date: r.date!,
  lane: r.resource === "activities" ? "money" : r.resource === "communications" ? "communications" : "legal",
  title: r.title,
  amount: r.resource === "activities" ? 45 : undefined,
  sources: [{ resource: r.resource, clioId: r.clioId }],
}));

export const fixtureTools: CaseTools = {
  listMatters: async () => [MATTER],
  listProviders: async () => PROVIDERS,
  getSummary: async () => wrap(SUMMARY, SUMMARY.sentences.flatMap((s) => s.sources)),
  getOpenItems: async () => wrap(OPEN_ITEMS, OPEN_ITEMS.flatMap((o) => o.sources)),
  getConflicts: async () => wrap(CONFLICTS, CONFLICTS.flatMap((c) => c.versions.flatMap((v) => v.sources))),
  getMoney: async () => wrap(MONEY, MONEY.lines.flatMap((l) => l.sources)),
  getNotDone: async () => wrap(NOT_DONE, NOT_DONE.flatMap((n) => n.sources)),
  getChanges: async (_m, since) => {
    const changes: Change[] = RECORDS.filter((r) => r.date! > since).map((r) => ({
      date: r.date!, kind: r.resource, title: r.title, sources: [{ resource: r.resource, clioId: r.clioId }],
    }));
    return wrap(changes, changes.flatMap((c) => c.sources));
  },
  searchRecords: async (_m, query) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits: SearchHit[] = RECORDS.map((r) => {
      const hay = `${r.title} ${r.text}`.toLowerCase();
      return { r, score: words.filter((w) => hay.includes(w)).length };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ r, score }) => ({ title: r.title, snippet: r.text.slice(0, 160), score, source: { resource: r.resource, clioId: r.clioId } }));
    return wrap(hits, hits.map((h) => h.source));
  },
  getRelated: async (_m, entity) => {
    const p = PROVIDERS.find((x) => x.name.toLowerCase().includes(entity.toLowerCase()));
    const related: Related = p
      ? { node: { id: p.nodeId, type: "provider", name: p.name }, links: [{ type: "treats", other: { id: 99, type: "person", name: MATTER.client }, source: null }] }
      : { node: null, links: [] };
    return wrap(related, []);
  },
  getRecord: async (ref) => RECORDS.find((r) => r.resource === ref.resource && r.clioId === ref.clioId) ?? null,
  getTimeline: async () => wrap(TIMELINE, TIMELINE.flatMap((t) => t.sources)),
  getShareable: async (_m, providerNodeId): Promise<Shareable> => ({
    stage: { label: "Case stage", payload: { stage: MATTER.stage, status: MATTER.status }, sources: [] },
    requests: {
      label: "What the firm needs from you",
      payload: providerNodeId === 1 ? OPEN_ITEMS.map((o) => ({ id: o.id, what: o.what, asks: o.asks, firstAsked: o.firstAsked })) : [],
      sources: OPEN_ITEMS.flatMap((o) => o.sources),
    },
    own_bills: { label: "Your bills as the firm holds them", payload: [], sources: [] },
    coverage: { label: "Insurance coverage", payload: { limit: 100000, basis: "carrier letter" }, sources: [src(102)] },
    other_treaters: { label: "Other treating providers", payload: PROVIDERS.filter((p) => p.nodeId !== providerNodeId).map((p) => ({ role: p.role })), sources: [] },
  }),
};
