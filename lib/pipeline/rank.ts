// Owner: Tijil. "The ten that matter": every record gets a score from a few features and a weight per feature.
// Pins and dismissals nudge the weights, so the list learns what this firm cares about.
// ponytail: a linear model with an online update; swap for a pairwise ranker (e.g. LambdaMART) once there is real feedback volume.
import { q } from "../db";
import type { SourceRef, Sourced } from "../contracts";
import { daysBetween } from "./compute";
import { readSection } from "./process";
import { loadRecords, type Rec } from "./records";

export type TopEntry = Sourced<{ resource: string; clioId: number; date: string | null; title: string; score: number; why: string[]; pinned: boolean }>;

const FEATURES = ["cited_open_item", "cited_conflict", "cited_not_done", "mentions_money", "recent", "is_note", "from_other_side"] as const;
type Feature = (typeof FEATURES)[number];
const DEFAULTS: Record<Feature, number> = { cited_open_item: 2, cited_conflict: 3, cited_not_done: 2.5, mentions_money: 1, recent: 1.5, is_note: 1, from_other_side: 0.5 };
const WHY: Record<Feature, string> = {
  cited_open_item: "part of an open item", cited_conflict: "one side of a conflict", cited_not_done: "something not yet done",
  mentions_money: "mentions money", recent: "recent", is_note: "attorney note", from_other_side: "came from outside the firm",
};
const LEARNING_RATE = 0.5;

async function weights(): Promise<Record<Feature, number>> {
  const rows = await q<{ feature: Feature; weight: number }>("SELECT feature, weight FROM ranker_weights");
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.feature, Number(r.weight)])) };
}

const k = (r: { resource: string; clioId: number }) => `${r.resource}:${r.clioId}`;

async function citedSets(matterId: number) {
  const cited = async (name: string, refs: (x: any) => SourceRef[]) => // eslint-disable-line @typescript-eslint/no-explicit-any
    new Set(((await readSection<any[]>(matterId, name)) ?? []).flatMap(refs).map(k)); // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    open: await cited("open_items", (o) => o.sources),
    conflict: await cited("conflicts", (c) => c.versions.flatMap((v: { sources: SourceRef[] }) => v.sources)),
    notDone: await cited("not_done", (n) => n.sources),
  };
}

function features(r: Rec, sets: Awaited<ReturnType<typeof citedSets>>, today: string): Record<Feature, number> {
  const age = r.date ? daysBetween(r.date, today) : 9999;
  return {
    cited_open_item: sets.open.has(k(r)) ? 1 : 0,
    cited_conflict: sets.conflict.has(k(r)) ? 1 : 0,
    cited_not_done: sets.notDone.has(k(r)) ? 1 : 0,
    mentions_money: /\$\s?\d/.test(r.text) ? 1 : 0,
    recent: age >= 0 && age <= 30 ? 1 : age <= 90 ? 0.5 : 0,
    is_note: r.resource === "notes" ? 1 : 0,
    from_other_side: r.resource === "communications" && !(r.data.senders ?? []).some((s: { type?: string }) => s?.type === "User") ? 1 : 0,
  };
}

async function scored(matterId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const [w, sets, recs] = [await weights(), await citedSets(matterId), await loadRecords(matterId, ["notes", "communications", "tasks", "calendar_entries"])];
  return recs.map((r) => {
    const f = features(r, sets, today);
    return { r, f, score: FEATURES.reduce((s, name) => s + w[name] * f[name], 0) };
  });
}

export async function topTen(matterId: number): Promise<TopEntry[]> {
  const fb = await q<{ resource: string; clio_id: string; action: string }>(
    "SELECT DISTINCT ON (resource, clio_id) resource, clio_id, action FROM feedback WHERE action IN ('pin','dismiss') ORDER BY resource, clio_id, at DESC",
  );
  const last = new Map(fb.map((x) => [`${x.resource}:${x.clio_id}`, x.action]));
  return (await scored(matterId))
    .filter((x) => last.get(k(x.r)) !== "dismiss")
    .sort((a, b) => Number(last.get(k(b.r)) === "pin") - Number(last.get(k(a.r)) === "pin") || b.score - a.score)
    .slice(0, 10)
    .map(({ r, f, score }) => ({
      resource: r.resource, clioId: r.clioId, date: r.date?.slice(0, 10) ?? null, title: r.title, score: Math.round(score * 100) / 100,
      why: FEATURES.filter((n) => f[n] > 0).map((n) => WHY[n]), pinned: last.get(k(r)) === "pin",
      sources: [{ resource: r.resource, clioId: r.clioId }],
    }));
}

/** Record a pin or dismissal and move each weight toward (pin) or away from (dismiss) that record's features. */
export async function feedback(matterId: number, userId: number, ref: SourceRef, action: "pin" | "dismiss") {
  await q("INSERT INTO feedback (user_id, resource, clio_id, action) VALUES ($1,$2,$3,$4)", [userId, ref.resource, ref.clioId, action]);
  const hit = (await scored(matterId)).find((x) => k(x.r) === k(ref));
  if (!hit) return;
  const w = await weights();
  const sign = action === "pin" ? 1 : -1;
  for (const name of FEATURES) {
    if (!hit.f[name]) continue;
    await q(
      "INSERT INTO ranker_weights (feature, weight) VALUES ($1,$2) ON CONFLICT (feature) DO UPDATE SET weight = $2",
      [name, Math.max(0, w[name] + sign * LEARNING_RATE * hit.f[name])],
    );
  }
}
