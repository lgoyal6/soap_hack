// Owner: Laksh. Publishing a snapshot to one provider: one transaction that checks the provider is on the case,
// locks and checks consent, compares the snapshot with what the firm previewed, and writes each changed category once.
// Database access is passed in, so tests run this against a disposable Postgres without the Next.js server.
import { createHash } from "node:crypto";
import type { ShareCategory } from "../contracts.ts";

export const PUBLISH_CATEGORIES: ShareCategory[] = ["stage", "requests", "own_bills", "coverage", "other_treaters"];

export class ShareError extends Error {
  // Plain fields (not parameter properties) so Node's type stripping can run this file in tests.
  status: number;
  extra: Record<string, unknown>;
  constructor(message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Key-order independent JSON, because jsonb does not keep key order. */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export type Snapshot = { label: string; payload: unknown };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Which version of a category's content this is. Same label and payload, same revision. */
export const revisionOf = (s: Snapshot) => sha(canon({ label: s.label ?? "", payload: s.payload ?? null }));

/** Binds provider, case, category and revision: a retry of the same publish has the same key. */
export const idempotencyKey = (matterId: number, nodeId: number, category: ShareCategory, revision: string) =>
  sha(`${matterId}|${nodeId}|${category}|${revision}`);

/** Correlation ids come from the caller's header when they look safe, otherwise are made here. */
export const requestIdFrom = (header: string | null | undefined, make: () => string) =>
  header && /^[A-Za-z0-9._:-]{8,80}$/.test(header) ? header : make();

/** The subset of pg's Pool / PoolClient used here. */
export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export type PoolLike = { connect: () => Promise<Queryable & { release: (err?: Error | boolean) => void }> };

export type PublishInput = {
  matterId: number;
  nodeId: number;
  /** Categories to publish. Omitted = the categories in `expected`, or without it every category with active consent. */
  categories?: ShareCategory[];
  /** Revision per category that the person approved in the preview. A different current revision is refused. */
  expected?: Partial<Record<ShareCategory, string>>;
  userId: number;
  requestId: string;
  patient: string | null;
  /** Current content of every category, built by the caller from the case tools. */
  snapshots: Record<ShareCategory, Snapshot>;
};

export type PublishResult = {
  requestId: string;
  published: ShareCategory[];
  unchanged: ShareCategory[];
  ids: number[];
  revisions: Partial<Record<ShareCategory, string>>;
};

/** Test seams. Production passes none. */
export type PublishHooks = {
  afterConsentCheck?: () => Promise<void>;
  afterInsert?: (category: ShareCategory) => Promise<void>;
};

/**
 * All or nothing. Inside one transaction:
 * 1. the provider must be a provider node on this case (row locked against deletion);
 * 2. consent rows for the wanted categories are locked FOR SHARE, so a revoke either committed before
 *    (and is seen, so the publish is refused) or waits until this publish commits (and then hides it);
 * 3. each category's current revision must equal the previewed one, if the caller sent one;
 * 4. each category is written only if its revision differs from the latest published one (publish_heads row lock),
 *    so a retry, a double click or two concurrent publishes of the same snapshot write one shared item;
 * 5. one outbox row tells the provider (if it has an active login) that something new is shared. Nothing is sent.
 */
export async function publishSnapshot(pool: PoolLike, input: PublishInput, hooks: PublishHooks = {}): Promise<PublishResult> {
  const { matterId, nodeId, userId, requestId } = input;
  if (!Number.isSafeInteger(matterId) || !Number.isSafeInteger(nodeId)) throw new ShareError("Bad case or provider id", 400);
  const asked = input.categories;
  if (asked) {
    const unknown = asked.filter((c) => !PUBLISH_CATEGORIES.includes(c));
    if (unknown.length) throw new ShareError("Unknown category", 400, { unknown });
  }

  const c = await pool.connect();
  let failed: Error | undefined;
  try {
    await c.query("BEGIN");
    const [node] = (await c.query(
      "SELECT id, props->>'email' AS email FROM nodes WHERE id = $1 AND matter_id = $2 AND type = 'provider' FOR SHARE",
      [nodeId, matterId],
    )).rows as { id: string; email: string | null }[];
    if (!node) throw new ShareError("That provider is not on this case", 404);

    const consentRows = (await c.query(
      "SELECT category FROM consent WHERE provider_node_id = $1 AND revoked_at IS NULL ORDER BY category FOR SHARE",
      [nodeId],
    )).rows as { category: ShareCategory }[];
    const consented = new Set(consentRows.map((r) => r.category));
    // The preview binds the set too: if the person approved categories that lost consent since, refuse rather than
    // quietly publish a different set from the one they saw.
    const previewed = input.expected ? PUBLISH_CATEGORIES.filter((x) => input.expected![x] !== undefined) : undefined;
    const wanted = asked ?? previewed ?? PUBLISH_CATEGORIES.filter((x) => consented.has(x));
    const refused = wanted.filter((x) => !consented.has(x));
    if (refused.length) throw new ShareError("No consent recorded for these categories; nothing was published", 403, { refused });
    if (!wanted.length) throw new ShareError("Nothing to publish: no category has consent", 400);
    await hooks.afterConsentCheck?.();

    const revisions: Partial<Record<ShareCategory, string>> = {};
    for (const cat of wanted) revisions[cat] = revisionOf(input.snapshots[cat] ?? { label: "", payload: null });
    const stale = wanted.filter((cat) => input.expected?.[cat] !== undefined && input.expected[cat] !== revisions[cat]);
    if (stale.length) throw new ShareError("The case changed since the preview; preview again before publishing", 409, { stale, revisions });

    const published: ShareCategory[] = [];
    const unchanged: ShareCategory[] = [];
    const ids: number[] = [];
    for (const cat of wanted) {
      const rev = revisions[cat]!;
      const key = idempotencyKey(matterId, nodeId, cat, rev);
      // Moves the head only when the revision differs. Under a concurrent publish this waits for the other
      // transaction and re-checks against its committed head, so the second writer sees "unchanged".
      const moved = (await c.query(
        `INSERT INTO publish_heads (matter_id, provider_node_id, category, source_revision) VALUES ($1,$2,$3,$4)
         ON CONFLICT (matter_id, provider_node_id, category) DO UPDATE
           SET source_revision = EXCLUDED.source_revision, updated_at = now(), shared_item_id = NULL
           WHERE publish_heads.source_revision IS DISTINCT FROM EXCLUDED.source_revision
         RETURNING 1`,
        [matterId, nodeId, cat, rev],
      )).rows.length > 0;
      if (!moved) {
        const [head] = (await c.query(
          "SELECT shared_item_id FROM publish_heads WHERE matter_id = $1 AND provider_node_id = $2 AND category = $3",
          [matterId, nodeId, cat],
        )).rows as { shared_item_id: string | null }[];
        await c.query(
          `INSERT INTO publish_jobs (idempotency_key, request_id, matter_id, provider_node_id, category, source_revision, outcome, shared_item_id, published_by)
           VALUES ($1,$2,$3,$4,$5,$6,'unchanged',$7,$8)`,
          [key, requestId, matterId, nodeId, cat, rev, head?.shared_item_id ?? null, userId],
        );
        unchanged.push(cat);
        continue;
      }
      const snap = input.snapshots[cat];
      // clock_timestamp(), not the transaction's start time: this row is written after taking the head lock,
      // so publication order (what the provider sees as latest) matches the order the head moved in.
      const [row] = (await c.query(
        `INSERT INTO shared_items (matter_id, provider_node_id, category, label, patient, payload, published_by, source_revision, request_id, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, clock_timestamp()) RETURNING id`,
        [matterId, nodeId, cat, snap?.label ?? "", input.patient, JSON.stringify(snap?.payload ?? null), userId, rev, requestId],
      )).rows as { id: string }[];
      const id = Number(row.id);
      await c.query(
        "UPDATE publish_heads SET shared_item_id = $4 WHERE matter_id = $1 AND provider_node_id = $2 AND category = $3",
        [matterId, nodeId, cat, id],
      );
      await c.query(
        `INSERT INTO publish_jobs (idempotency_key, request_id, matter_id, provider_node_id, category, source_revision, outcome, shared_item_id, published_by)
         VALUES ($1,$2,$3,$4,$5,$6,'published',$7,$8)`,
        [key, requestId, matterId, nodeId, cat, rev, id, userId],
      );
      published.push(cat);
      ids.push(id);
      await hooks.afterInsert?.(cat);
    }

    if (published.length && node.email) {
      await c.query(
        `INSERT INTO outbox (matter_id, reason, recipient, subject, body)
         SELECT $1, 'shared', u.email, 'The firm shared an update with you', 'Sign in to the provider portal to see it.'
         FROM users u JOIN access_codes a ON a.user_id = u.id AND a.revoked_at IS NULL
         WHERE u.role = 'provider' AND u.email = lower($2)`,
        [matterId, node.email],
      );
    }
    await c.query("COMMIT");
    return { requestId, published, unchanged, ids, revisions };
  } catch (e) {
    failed = e as Error;
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    // A connection whose rollback failed is discarded rather than reused.
    c.release(failed && !(failed instanceof ShareError) ? failed : undefined);
  }
}

/**
 * What a provider login can read: the latest item per case and category, only from its own provider nodes,
 * and only while that category's consent is active. Shared by the portal and the tests.
 */
export const PROVIDER_ITEMS_SQL = `SELECT DISTINCT ON (s.matter_id, s.category) s.id, s.matter_id, s.provider_node_id, s.category, s.label, s.patient, s.payload, s.published_at
     FROM shared_items s
     JOIN consent c ON c.provider_node_id = s.provider_node_id AND c.category = s.category AND c.revoked_at IS NULL
     WHERE s.provider_node_id = ANY($1) AND ($2::bigint IS NULL OR s.matter_id = $2)
     ORDER BY s.matter_id, s.category, s.published_at DESC, s.id DESC`;
