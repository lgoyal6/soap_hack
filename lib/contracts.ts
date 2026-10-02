// Owner: Tijil. FROZEN after the foundation step: both lanes build against these shapes.
// See BUILD_PLAN.md "Rule 2" for who implements and who calls each contract.

// ---- Sources ---------------------------------------------------------------

/** Points at one Clio record (and optionally a page and a verbatim quote inside it). */
export type SourceRef = { resource: string; clioId: number; pageNo?: number; quote?: string };

/** Every tool returns its data, the records behind it, and how much was actually read. */
export type ToolResult<T> = { data: T; sources: SourceRef[]; searched: { records: number; pages: number } };

// ---- Contract A: case tools (implemented in lib/tools) -----------------------

export type Matter = { id: number; name: string; client: string; stage: string | null; status: string | null };

export type Provider = { nodeId: number; name: string; email: string | null; role: string | null };

export type Sourced<T> = T & { sources: SourceRef[] };

export type Summary = {
  header: {
    clientName: string;
    photoDocumentId: number | null;
    stage: string | null;
    lastClientContact: Sourced<{ date: string }> | null;
    limitations: Sourced<{ date: string | null; status: string }> | null;
    firmSpend: Sourced<{ amount: number }>;
    pagesRead: { done: number; total: number };
  };
  /** Model-written, each sentence checked against its sources before it is stored. */
  sentences: Sourced<{ text: string }>[];
};

export type Party = "us" | "client" | "provider" | "defence" | "court" | "other";

export type OpenItem = Sourced<{
  id: string;
  what: string;
  waitingOn: string;
  party: Party;
  asks: number;
  daysOpen: number;
  firstAsked: string;
  lastAsked: string;
  /** Other counts of the same thing found in the file, when they disagree with `asks`. */
  otherCounts: Sourced<{ value: number }>[];
  /** Latest one-click reply from the provider portal, if any (contract E). */
  providerReply: { reply: string; replyDate: string | null; at: string } | null;
}>;

export type Conflict = { id: string; topic: string; versions: Sourced<{ value: string; date: string | null }>[] };

export type MoneyLine = Sourced<{ label: string; amount: number | null; foundation: string }>;
export type Money = {
  lines: MoneyLine[];
  netToClient: { amount: number | null; formula: string; inputs: { label: string; amount: number }[]; assumption: string };
};

export type NotDone = Sourced<{ id: string; what: string; since: string; daysOpen: number }>;

export type Change = Sourced<{ date: string; kind: string; title: string }>;

export type SearchHit = { title: string; snippet: string; score: number; source: SourceRef };

export type Related = {
  node: { id: number; type: string; name: string } | null;
  links: { type: string; other: { id: number; type: string; name: string }; source: SourceRef | null }[];
};

export type Lane = "medical" | "legal" | "money" | "communications";
export type TimelineEvent = Sourced<{ date: string; lane: Lane; title: string; amount?: number }>;

export type RecordDetail = { resource: string; clioId: number; title: string; date: string | null; text: string; pageNo?: number };

export type ShareCategory = "stage" | "requests" | "own_bills" | "coverage" | "other_treaters";
export type Shareable = Record<ShareCategory, Sourced<{ label: string; payload: unknown }>>;

export interface CaseTools {
  listMatters(): Promise<Matter[]>;
  listProviders(matterId: number): Promise<Provider[]>;
  getSummary(matterId: number): Promise<ToolResult<Summary>>;
  getOpenItems(matterId: number): Promise<ToolResult<OpenItem[]>>;
  getConflicts(matterId: number): Promise<ToolResult<Conflict[]>>;
  getMoney(matterId: number): Promise<ToolResult<Money>>;
  getNotDone(matterId: number): Promise<ToolResult<NotDone[]>>;
  getChanges(matterId: number, since: string): Promise<ToolResult<Change[]>>;
  searchRecords(matterId: number, query: string): Promise<ToolResult<SearchHit[]>>;
  getRelated(matterId: number, entity: string): Promise<ToolResult<Related>>;
  getRecord(ref: SourceRef): Promise<RecordDetail | null>;
  getTimeline(matterId: number): Promise<ToolResult<TimelineEvent[]>>;
  getShareable(matterId: number, providerNodeId: number): Promise<Shareable>;
}

// ---- Contract B: session (implemented in lib/session.ts) ---------------------

export type Role = "firm" | "provider";
export type Session = { userId: number; role: Role; providerNodeId?: number };

// ---- Contract C: voice moves the page (browser events) -----------------------

export type SectionName = "summary" | "conflicts" | "money" | "open_items" | "not_done" | "top_ten" | "changes";

export const EVENTS = { show: "casebrief:show", chips: "casebrief:chips", replay: "casebrief:replay" } as const;
export type ShowDetail = { section?: SectionName; source?: SourceRef };
export type ChipsDetail = { sources: SourceRef[] };
export type ReplayDetail = { from?: string; to?: string };
