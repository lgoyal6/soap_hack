// Owner: Laksh. Provider side of the portal. Reads ONLY shared_items (with active consent), the provider's
// own replies and its own lien. Every query is scoped to the nodes this login may see.
import type { Session, ShareCategory } from "../contracts";
import { q } from "../db";
import { readLien } from "./lien";
import { checkStageChange } from "./outbox";
import { repliesFor } from "./share";
import { REPLIES, type ProviderCase, type ReplyKind, type SharedItem } from "./types";

export type ProviderCtx = { userId: number; email: string; name: string | null; prevLogin: string | null; nodeIds: number[] };

/** Null unless this is a provider session whose access code is still active. */
export async function providerCtx(s: Session | null): Promise<ProviderCtx | null> {
  if (s?.role !== "provider") return null;
  const [u] = await q<{ id: string; email: string; name: string | null; prev_login: Date | null; provider_node_id: string | null }>(
    `SELECT u.id, u.email, u.name, u.prev_login, u.provider_node_id FROM users u
     JOIN access_codes a ON a.user_id = u.id AND a.revoked_at IS NULL
     WHERE u.id = $1 AND u.role = 'provider'`,
    [s.userId],
  );
  if (!u) return null;
  // A practice is one email; it may appear as a provider on several of the firm's cases.
  const nodes = await q<{ id: string }>(
    "SELECT id FROM nodes WHERE type = 'provider' AND (lower(props->>'email') = $1 OR id = $2)",
    [u.email, u.provider_node_id],
  );
  return { userId: Number(u.id), email: u.email, name: u.name, prevLogin: u.prev_login?.toISOString() ?? null, nodeIds: nodes.map((n) => Number(n.id)) };
}

type ItemRow = { id: string; matter_id: string; provider_node_id: string; category: ShareCategory; label: string; patient: string | null; payload: unknown; published_at: Date };

/** Latest published item per case and category, only where consent is still active. */
async function items(ctx: ProviderCtx, matterId?: number): Promise<ItemRow[]> {
  return q<ItemRow>(
    `SELECT DISTINCT ON (s.matter_id, s.category) s.id, s.matter_id, s.provider_node_id, s.category, s.label, s.patient, s.payload, s.published_at
     FROM shared_items s
     JOIN consent c ON c.provider_node_id = s.provider_node_id AND c.category = s.category AND c.revoked_at IS NULL
     WHERE s.provider_node_id = ANY($1) AND ($2::bigint IS NULL OR s.matter_id = $2)
     ORDER BY s.matter_id, s.category, s.published_at DESC`,
    [ctx.nodeIds, matterId ?? null],
  );
}

const toItem = (r: ItemRow, since: string | null): SharedItem => ({
  id: Number(r.id), matterId: Number(r.matter_id), category: r.category, label: r.label, payload: r.payload,
  publishedAt: r.published_at.toISOString(), isNew: !!since && r.published_at.toISOString() > since,
});

export async function practiceHome(ctx: ProviderCtx) {
  const rows = await items(ctx);
  const byMatter = new Map<number, ItemRow[]>();
  for (const r of rows) byMatter.set(Number(r.matter_id), [...(byMatter.get(Number(r.matter_id)) ?? []), r]);
  const out = [];
  for (const [matterId, rs] of byMatter) {
    await checkStageChange(matterId).catch(() => {});
    const nodeId = Number(rs[0].provider_node_id);
    const lien = await readLien(matterId, nodeId);
    const newItems = rs.filter((r) => ctx.prevLogin && r.published_at.toISOString() > ctx.prevLogin);
    const newLien = lien?.history.filter((h) => h.by === "firm" && ctx.prevLogin && h.at > ctx.prevLogin) ?? [];
    const stage = rs.find((r) => r.category === "stage")?.payload as { stage?: string | null; status?: string | null } | undefined;
    const requests = rs.find((r) => r.category === "requests")?.payload;
    out.push({
      matterId,
      patient: rs.find((r) => r.patient)?.patient ?? null,
      stage: stage?.stage ?? null,
      status: stage?.status ?? null,
      openRequests: Array.isArray(requests) ? requests.length : null,
      lastUpdate: rs.map((r) => r.published_at.toISOString()).sort().at(-1)!,
      moved: [...newItems.map((r) => `${r.label} updated`), ...newLien.map((h) => `Lien: firm ${h.action.replace(/_/g, " ")}`)],
    });
  }
  return out.sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate));
}

export async function providerCase(ctx: ProviderCtx, matterId: number): Promise<(ProviderCase & { nodeId: number }) | null> {
  const rows = await items(ctx, matterId);
  if (!rows.length) return null;
  const nodeId = Number(rows[0].provider_node_id);
  return {
    matterId, nodeId,
    patient: rows.find((r) => r.patient)?.patient ?? null,
    items: rows.map((r) => toItem(r, ctx.prevLogin)),
    replies: await repliesFor(matterId, [nodeId]),
    lien: await readLien(matterId, nodeId),
  };
}

export class PortalError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function reply(ctx: ProviderCtx, matterId: number, requestId: string, kind: ReplyKind, replyDate: string | null, note: string | null) {
  if (!(kind in REPLIES)) throw new PortalError("Unknown reply", 400);
  if (kind === "sending_by" && !/^\d{4}-\d{2}-\d{2}$/.test(replyDate ?? "")) throw new PortalError("Pick the date you will send by", 400);
  const [req] = (await items(ctx, matterId)).filter((r) => r.category === "requests");
  // The request must be one the firm actually published to this provider.
  if (!req || !Array.isArray(req.payload) || !req.payload.some((p: { id?: string }) => p?.id === requestId)) {
    throw new PortalError("That request was not shared with you", 404);
  }
  await q(
    `INSERT INTO provider_replies (shared_item_id, request_id, provider_node_id, reply, reply_date, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.id, requestId, req.provider_node_id, kind, kind === "sending_by" ? replyDate : null, note?.slice(0, 500) || null],
  );
}

/** The node this provider holds on a case it can see, or null. Used for lien steps. */
export async function nodeOnCase(ctx: ProviderCtx, matterId: number): Promise<number | null> {
  const rows = await items(ctx, matterId);
  return rows.length ? Number(rows[0].provider_node_id) : null;
}

export async function logView(userId: number, matterId: number | null, path: string) {
  await q("INSERT INTO view_log (user_id, matter_id, path) VALUES ($1,$2,$3)", [userId, matterId, path]).catch(() => {});
}
