// Owner: Laksh. Shapes shared by the provider portal, the share panel and their API routes.
// No server imports here: client components use this file too.
import type { Provider, ShareCategory } from "../contracts";

export const CATEGORIES: ShareCategory[] = ["stage", "requests", "own_bills", "coverage", "other_treaters"];

export const CATEGORY_LABEL: Record<ShareCategory, string> = {
  stage: "Case stage",
  requests: "What the firm needs",
  own_bills: "Their own bills",
  coverage: "Insurance coverage",
  other_treaters: "Other treating providers",
};

/** The four one-click replies a provider can give to a request. */
export const REPLIES = {
  sending_by: "Sending by",
  waiting_on_patient: "Waiting on the patient",
  balance_holding: "Unpaid balance is holding this up",
  not_proceeding: "Not proceeding",
} as const;
export type ReplyKind = keyof typeof REPLIES;

export type SharedItem = {
  id: number;
  matterId: number;
  category: ShareCategory;
  label: string;
  payload: unknown;
  publishedAt: string;
  isNew?: boolean;
};

export type ReplyRow = { requestId: string; reply: ReplyKind; replyDate: string | null; note: string | null; at: string };

export type LienAction = "confirm" | "request_reduction" | "accept" | "counter" | "accept_counter";
export type LienStatus = "open" | "balance_confirmed" | "reduction_requested" | "accepted" | "countered";
export type LienEvent = { at: string; by: "firm" | "provider"; action: LienAction; amount: number | null; note?: string };
export type Lien = { balance: number | null; status: LienStatus; history: LienEvent[] };

/** Everything one provider sees for one case. Built only from `shared_items` plus its own replies and lien. */
export type ProviderCase = { matterId: number; patient: string | null; items: SharedItem[]; replies: ReplyRow[]; lien: Lien | null };

/** One row of the firm's share panel. */
export type ProviderShare = {
  provider: Provider;
  consent: Record<ShareCategory, { granted: boolean; at: string | null }>;
  /** What publishing now would send, per category (only categories with consent). */
  preview: ProviderCase;
  /** Categories that would not be sent, and why. */
  heldBack: { category: ShareCategory; label: string; reason: string; items: number }[];
  /** Latest publish per category. `stale` = the case has moved on since. */
  published: Partial<Record<ShareCategory, { at: string; stale: boolean }>>;
  code: { active: boolean; createdAt: string; revokedAt: string | null } | null;
  views: { count: number; last: string | null };
  replies: ReplyRow[];
  lien: Lien | null;
};

export type SharePanelData = {
  matterId: number;
  patient: string | null;
  providers: ProviderShare[];
  outbox: { recipient: string; subject: string; at: string; reason: string | null }[];
};

/** Count of items in a category payload, for "held back" and the provider's summary. */
export function itemCount(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === "object") return Object.values(payload).some((v) => v !== null && v !== undefined) ? 1 : 0;
  return payload === null || payload === undefined ? 0 : 1;
}
