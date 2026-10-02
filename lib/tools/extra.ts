// Owner: Tijil. The at-a-glance facts as tools: client and accident, injuries by body part, and the
// client-as-witness check. Read from the sections and facts the pipeline already stored.
import { q } from "../db";
import type { SourceRef } from "../contracts";
import { readSection } from "../pipeline/process";

export type Injury = { bodyPart: string; findings: { quote: string; source: SourceRef }[] };

/** Injuries found in records and scan pages, grouped by body part, each with its page-linked quote. */
export async function getInjuries(matterId: number): Promise<Injury[]> {
  const rows = await q<{ subject: string; quote: string; resource: string; clio_id: string; page_no: number | null }>(
    "SELECT subject, quote, resource, clio_id, page_no FROM facts WHERE matter_id = $1 AND type = 'injury' ORDER BY subject, id", [matterId]);
  const by = new Map<string, Injury>();
  for (const r of rows) {
    const key = (r.subject || "unspecified").replace(/-/g, " ");
    const g = by.get(key) ?? by.set(key, { bodyPart: key, findings: [] }).get(key)!;
    if (g.findings.length < 4) g.findings.push({ quote: r.quote, source: { resource: r.resource, clioId: Number(r.clio_id), ...(r.page_no ? { pageNo: r.page_no } : {}), quote: r.quote } });
  }
  return [...by.values()];
}

/** Who the client is, what happened and where, and how the client is likely to hold up as a witness. */
export async function getGlance(matterId: number) {
  return {
    glance: await readSection(matterId, "glance"),
    witness: (await readSection<unknown[]>(matterId, "witness")) ?? [],
    news: (await readSection(matterId, "news")) ?? { since: null, records: 0, sentences: [] },
  };
}
