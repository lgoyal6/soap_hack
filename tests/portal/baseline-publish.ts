// Owner: Laksh. The publish path as it was at commit ec969ef (lib/portal/share.ts, publish()), kept as the negative
// control for tests/portal/publish-race.test.ts and the publication study. Same SQL statements in the same order:
// read consent (no lock, no transaction), refuse categories without consent, then insert one row per category.
// It is not used by the app.
import type { ShareCategory } from "../../lib/contracts.ts";
import { PUBLISH_CATEGORIES, ShareError, type Snapshot } from "../../lib/portal/publish.ts";

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export async function baselinePublish(
  db: Q,
  input: { matterId: number; nodeId: number; categories?: ShareCategory[]; userId: number | null; patient: string | null; snapshots: Record<ShareCategory, Snapshot> },
  hooks: { afterConsentCheck?: () => Promise<void> } = {},
) {
  const { matterId, nodeId } = input;
  const [n] = (await db.query("SELECT id FROM nodes WHERE id = $1 AND matter_id = $2 AND type = 'provider'", [nodeId, matterId])).rows;
  if (!n) throw new ShareError("That provider is not on this case", 404);
  const rows = (await db.query("SELECT category, granted_at, revoked_at FROM consent WHERE provider_node_id = $1", [nodeId])).rows as { category: ShareCategory; revoked_at: Date | null }[];
  const granted = new Set(rows.filter((r) => !r.revoked_at).map((r) => r.category));
  const consented = PUBLISH_CATEGORIES.filter((c) => granted.has(c));
  const wanted = input.categories ?? consented;
  const refused = wanted.filter((c) => !granted.has(c));
  if (refused.length) throw new ShareError("No consent recorded for these categories; nothing was published", 403, { refused });
  if (!wanted.length) throw new ShareError("Nothing to publish: no category has consent", 400);
  await hooks.afterConsentCheck?.();
  const ids: number[] = [];
  for (const c of wanted) {
    const [row] = (await db.query(
      `INSERT INTO shared_items (matter_id, provider_node_id, category, label, patient, payload, published_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [matterId, nodeId, c, input.snapshots[c].label, input.patient, JSON.stringify(input.snapshots[c].payload ?? null), input.userId],
    )).rows as { id: string }[];
    ids.push(Number(row.id));
  }
  return { published: wanted, ids };
}
