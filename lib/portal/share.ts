// Owner: Laksh. Firm side of the provider portal: consent, publishing, access codes, the share panel's data.
// Trust rule 6: nothing reaches a provider until a person publishes it, and only categories with consent.
import type { ShareCategory, Shareable } from "../contracts";
import { q } from "../db";
import { tools } from "../tools";
import { hashCode, newCode } from "./codes";
import { readLien } from "./lien";
import { checkStageChange } from "./outbox";
import { CATEGORIES, CATEGORY_LABEL, itemCount, type ProviderCase, type ProviderShare, type ReplyRow, type SharePanelData } from "./types";

export class ShareError extends Error {
  constructor(message: string, public status: number, public extra: Record<string, unknown> = {}) { super(message); }
}

/** Key-order independent JSON, because jsonb does not keep key order. */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** The provider must be a provider node on this matter; anything else is refused. */
export async function providerOnMatter(matterId: number, nodeId: number) {
  const [n] = await q<{ id: string; name: string; email: string | null }>(
    "SELECT id, name, props->>'email' AS email FROM nodes WHERE id = $1 AND matter_id = $2 AND type = 'provider'",
    [nodeId, matterId],
  );
  if (!n) throw new ShareError("That provider is not on this case", 404);
  return { nodeId: Number(n.id), name: n.name, email: n.email };
}

export async function consentFor(nodeId: number): Promise<Record<ShareCategory, { granted: boolean; at: string | null }>> {
  const rows = await q<{ category: ShareCategory; granted_at: Date; revoked_at: Date | null }>(
    "SELECT category, granted_at, revoked_at FROM consent WHERE provider_node_id = $1", [nodeId]);
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, { granted: false, at: null as string | null }])) as Record<ShareCategory, { granted: boolean; at: string | null }>;
  for (const r of rows) out[r.category] = { granted: !r.revoked_at, at: (r.revoked_at ?? r.granted_at).toISOString() };
  return out;
}

export async function setConsent(matterId: number, nodeId: number, category: ShareCategory, granted: boolean, userId: number) {
  if (!CATEGORIES.includes(category)) throw new ShareError("Unknown category", 400);
  await providerOnMatter(matterId, nodeId);
  if (granted) {
    await q(
      `INSERT INTO consent (provider_node_id, category, granted_by, granted_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (provider_node_id, category) DO UPDATE SET granted_by = $3, granted_at = now(), revoked_at = NULL`,
      [nodeId, category, userId],
    );
  } else {
    // Revoking also hides what was already published in that category: the portal joins on active consent.
    await q("UPDATE consent SET revoked_at = now() WHERE provider_node_id = $1 AND category = $2 AND revoked_at IS NULL", [nodeId, category]);
  }
}

async function patientName(matterId: number): Promise<string | null> {
  const m = (await tools.listMatters()).find((x) => x.id === matterId);
  return m?.client || null;
}

/** Strip sources: a provider sees the label and the payload, never Clio record ids. */
function previewFrom(matterId: number, patient: string | null, shareable: Shareable, consented: ShareCategory[]): ProviderCase {
  const now = new Date().toISOString();
  return {
    matterId, patient,
    items: consented.map((c, i) => ({ id: -1 - i, matterId, category: c, label: shareable[c].label, payload: shareable[c].payload, publishedAt: now })),
    replies: [], lien: null,
  };
}

export async function publish(matterId: number, nodeId: number, categories: ShareCategory[] | undefined, userId: number) {
  await providerOnMatter(matterId, nodeId);
  const consent = await consentFor(nodeId);
  const consented = CATEGORIES.filter((c) => consent[c].granted);
  const wanted = categories ?? consented;
  const unknown = wanted.filter((c) => !CATEGORIES.includes(c));
  if (unknown.length) throw new ShareError("Unknown category", 400, { unknown });
  const refused = wanted.filter((c) => !consent[c].granted);
  if (refused.length) throw new ShareError("No consent recorded for these categories; nothing was published", 403, { refused });
  if (!wanted.length) throw new ShareError("Nothing to publish: no category has consent", 400);

  const shareable = await tools.getShareable(matterId, nodeId);
  const patient = await patientName(matterId);
  const ids: number[] = [];
  for (const c of wanted) {
    const [row] = await q<{ id: string }>(
      `INSERT INTO shared_items (matter_id, provider_node_id, category, label, patient, payload, published_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [matterId, nodeId, c, shareable[c].label, patient, JSON.stringify(shareable[c].payload ?? null), userId],
    );
    ids.push(Number(row.id));
  }
  return { published: wanted, ids };
}

/** Creates (or replaces) the provider's login and returns the code. The code is shown once and never stored in clear. */
export async function generateCode(matterId: number, nodeId: number) {
  const p = await providerOnMatter(matterId, nodeId);
  if (!p.email) throw new ShareError("This provider has no email address in Clio, so it cannot sign in", 400);
  const [u] = await q<{ id: string }>(
    `INSERT INTO users (role, email, name, provider_node_id) VALUES ('provider', lower($1), $2, $3)
     ON CONFLICT (role, email) DO UPDATE SET name = $2, provider_node_id = COALESCE(users.provider_node_id, $3) RETURNING id`,
    [p.email, p.name, nodeId],
  );
  const code = newCode();
  await q(
    `INSERT INTO access_codes (user_id, code_hash) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = $2, created_at = now(), revoked_at = NULL`,
    [u.id, hashCode(code)],
  );
  return { email: p.email.toLowerCase(), code };
}

export async function revokeCode(matterId: number, nodeId: number) {
  const p = await providerOnMatter(matterId, nodeId);
  if (!p.email) return;
  await q(
    `UPDATE access_codes SET revoked_at = now() WHERE revoked_at IS NULL
       AND user_id = (SELECT id FROM users WHERE role = 'provider' AND email = lower($1))`,
    [p.email],
  );
}

export async function repliesFor(matterId: number, nodeIds: number[]): Promise<ReplyRow[]> {
  const rows = await q<{ request_id: string; reply: ReplyRow["reply"]; reply_date: Date | null; note: string | null; at: Date }>(
    `SELECT r.request_id, r.reply, r.reply_date, r.note, r.at FROM provider_replies r
     JOIN shared_items s ON s.id = r.shared_item_id
     WHERE s.matter_id = $1 AND r.provider_node_id = ANY($2) ORDER BY r.at DESC`,
    [matterId, nodeIds],
  );
  return rows.map((r) => ({
    requestId: r.request_id, reply: r.reply, note: r.note, at: r.at.toISOString(),
    replyDate: r.reply_date ? new Date(r.reply_date).toISOString().slice(0, 10) : null,
  }));
}

export async function panelData(matterId: number): Promise<SharePanelData> {
  await checkStageChange(matterId).catch(() => {});
  const providers = await tools.listProviders(matterId);
  const patient = await patientName(matterId);
  const out: ProviderShare[] = [];
  for (const p of providers) {
    const consent = await consentFor(p.nodeId);
    const shareable = await tools.getShareable(matterId, p.nodeId);
    const consented = CATEGORIES.filter((c) => consent[c].granted);
    const latest = await q<{ category: ShareCategory; payload: unknown; published_at: Date }>(
      `SELECT DISTINCT ON (category) category, payload, published_at FROM shared_items
       WHERE matter_id = $1 AND provider_node_id = $2 ORDER BY category, published_at DESC`,
      [matterId, p.nodeId],
    );
    const published: ProviderShare["published"] = {};
    for (const l of latest) published[l.category] = { at: l.published_at.toISOString(), stale: canon(l.payload) !== canon(shareable[l.category].payload ?? null) };

    const [code] = p.email ? await q<{ created_at: Date; revoked_at: Date | null }>(
      `SELECT a.created_at, a.revoked_at FROM access_codes a JOIN users u ON u.id = a.user_id
       WHERE u.role = 'provider' AND u.email = lower($1)`, [p.email]) : [];
    const [views] = p.email ? await q<{ n: string; last: Date | null }>(
      `SELECT count(*) AS n, max(v.at) AS last FROM view_log v JOIN users u ON u.id = v.user_id
       WHERE v.matter_id = $1 AND u.role = 'provider' AND u.email = lower($2)`, [matterId, p.email]) : [];

    out.push({
      provider: p,
      consent,
      preview: previewFrom(matterId, patient, shareable, consented),
      heldBack: CATEGORIES.filter((c) => !consent[c].granted).map((c) => ({
        category: c, label: shareable[c].label || CATEGORY_LABEL[c], items: itemCount(shareable[c].payload),
        reason: c === "coverage" ? "Off by default. Defense counsel may read anything shared." : "No consent recorded",
      })),
      published,
      code: code ? { active: !code.revoked_at, createdAt: code.created_at.toISOString(), revokedAt: code.revoked_at?.toISOString() ?? null } : null,
      views: { count: Number(views?.n ?? 0), last: views?.last?.toISOString() ?? null },
      replies: await repliesFor(matterId, [p.nodeId]),
      lien: await readLien(matterId, p.nodeId),
    });
  }
  const outbox = await q<{ recipient: string; subject: string; at: Date; reason: string | null }>(
    "SELECT recipient, subject, at, reason FROM outbox WHERE matter_id = $1 AND reason IS DISTINCT FROM 'imessage' ORDER BY at DESC LIMIT 20", [matterId]);
  return { matterId, patient, providers: out, outbox: outbox.map((o) => ({ ...o, at: o.at.toISOString() })) };
}
