// Owner: Laksh. Emails that would be sent to providers. Nothing is sent: rows go to `outbox` only.
import { q } from "../db";
import { tools } from "../tools";

/**
 * Compares the matter's stage with the last one seen. On a change, every provider with an active login on
 * this case gets an outbox email. The email names the new stage only if that provider has stage consent.
 */
export async function checkStageChange(matterId: number) {
  const matter = (await tools.listMatters()).find((m) => m.id === matterId);
  if (!matter) return;
  const stage = matter.stage ?? null;
  const [seen] = await q<{ stage: string | null }>("SELECT stage FROM stage_seen WHERE matter_id = $1", [matterId]);
  if (!seen) {
    await q("INSERT INTO stage_seen (matter_id, stage) VALUES ($1,$2) ON CONFLICT DO NOTHING", [matterId, stage]);
    return;
  }
  if (seen.stage === stage) return;
  await q("UPDATE stage_seen SET stage = $2, at = now() WHERE matter_id = $1", [matterId, stage]);

  const settled = /settle/i.test(stage ?? "") || /settle/i.test(matter.status ?? "");
  const recipients = await q<{ email: string; stage_ok: boolean }>(
    `SELECT u.email, EXISTS (SELECT 1 FROM consent c WHERE c.provider_node_id = n.id AND c.category = 'stage' AND c.revoked_at IS NULL) AS stage_ok
     FROM nodes n JOIN users u ON u.role = 'provider' AND u.email = lower(n.props->>'email')
     JOIN access_codes a ON a.user_id = u.id AND a.revoked_at IS NULL
     WHERE n.matter_id = $1 AND n.type = 'provider'`,
    [matterId],
  );
  for (const r of recipients) {
    const subject = settled ? "A case you are treating has settled" : "A case you are treating has moved to a new stage";
    const body = r.stage_ok
      ? `${subject}. New stage: ${stage ?? "not set"}. Sign in to the provider portal for details.`
      : `${subject}. Sign in to the provider portal to see what the firm has shared with you.`;
    await q("INSERT INTO outbox (matter_id, reason, recipient, subject, body) VALUES ($1,$2,$3,$4,$5)",
      [matterId, settled ? "settlement" : "stage_change", r.email, subject, body]);
  }
}
