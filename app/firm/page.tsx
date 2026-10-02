// Owner: Tijil. The firm's one-page brief. Reads everything through the case tools (contract A).
import FirmBrief from "@/components/firm/FirmBrief";
import SyncButton from "@/components/firm/SyncButton";
import { q } from "@/lib/db";
import { topTen } from "@/lib/pipeline/rank";
import { requireRole } from "@/lib/session";
import { tools } from "@/lib/tools";

export const dynamic = "force-dynamic";

export default async function FirmHome({ searchParams }: { searchParams: Promise<{ matter?: string }> }) {
  const session = await requireRole("firm");
  const matters = await tools.listMatters();
  const { matter: wanted } = await searchParams;
  const matter = matters.find((m) => String(m.id) === wanted) ?? matters[0];
  if (!matter) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-lg">
        <h1 className="mb-3 text-3xl font-bold">No case yet</h1>
        <p className="mb-4">Nothing has been read from Clio. This reads the case and builds the brief.</p>
        <SyncButton />
      </main>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  // "What is new" defaults to this user's last visit on an earlier day, or thirty days back on a first visit.
  const [visit] = await q<{ prev_at: Date | null }>(
    `INSERT INTO firm_visits (user_id, matter_id) VALUES ($1,$2)
     ON CONFLICT (user_id, matter_id) DO UPDATE SET
       prev_at = CASE WHEN firm_visits.at::date < current_date THEN firm_visits.at ELSE firm_visits.prev_at END, at = now()
     RETURNING prev_at`,
    [session.userId, matter.id],
  ).catch(() => []);
  const since = (visit?.prev_at ?? new Date(Date.now() - 30 * 86_400_000)).toISOString().slice(0, 10);

  const [summary, openItems, conflicts, money, notDone, changes, timeline, top] = await Promise.all([
    tools.getSummary(matter.id), tools.getOpenItems(matter.id), tools.getConflicts(matter.id), tools.getMoney(matter.id),
    tools.getNotDone(matter.id), tools.getChanges(matter.id, since), tools.getTimeline(matter.id),
    process.env.USE_FIXTURES === "1" ? Promise.resolve([]) : topTen(matter.id),
  ]);

  return (
    <main className="min-h-screen bg-neutral-100 pb-40">
      {matters.length > 1 && (
        <nav className="mx-auto max-w-6xl px-5 pt-4 text-lg">
          Case: {matters.map((m) => <a key={m.id} href={`/firm?matter=${m.id}`} className={`mr-4 underline ${m.id === matter.id ? "font-bold" : ""}`}>{m.client || m.name}</a>)}
        </nav>
      )}
      <FirmBrief {...{ matter, today, since, summary, openItems, conflicts, money, notDone, changes, timeline, top }} />
    </main>
  );
}
