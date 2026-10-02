// Owner: Laksh. One-screen widget home: every section of the brief as a tile; a tile opens as a tab.
// Reads everything through the case tools (contract A), like the classic /firm page.
import Dashboard from "@/components/dashboard/Dashboard";
import SyncButton from "@/components/firm/SyncButton";
import { q } from "@/lib/db";
import { topTen } from "@/lib/pipeline/rank";
import { requireRole } from "@/lib/session";
import { tools } from "@/lib/tools";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ matter?: string }> }) {
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
  // "What is new" starts from this user's last visit on an earlier day (recorded by /firm), else thirty days back.
  const [visit] = await q<{ prev_at: Date | null; at: Date }>(
    "SELECT prev_at, at FROM firm_visits WHERE user_id = $1 AND matter_id = $2", [session.userId, matter.id]).catch(() => []);
  const last = visit ? (visit.at.toISOString().slice(0, 10) < today ? visit.at : visit.prev_at) : null;
  const since = (last ?? new Date(Date.parse(today) - 30 * 86_400_000)).toISOString().slice(0, 10);

  const [summary, openItems, conflicts, money, notDone, changes, timeline, top] = await Promise.all([
    tools.getSummary(matter.id), tools.getOpenItems(matter.id), tools.getConflicts(matter.id), tools.getMoney(matter.id),
    tools.getNotDone(matter.id), tools.getChanges(matter.id, since), tools.getTimeline(matter.id),
    process.env.USE_FIXTURES === "1" ? Promise.resolve([]) : topTen(matter.id),
  ]);
  return <Dashboard {...{ matters, matter, today, since, summary, openItems, conflicts, money, notDone, changes, timeline, top }} />;
}
