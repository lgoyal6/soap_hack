// Owner: Laksh. Practice home: every patient this practice has with the firm, and what moved since last login.
import { redirect } from "next/navigation";
import { logView, practiceHome, providerCtx } from "@/lib/portal/provider";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function ProviderHome() {
  const ctx = await providerCtx(await getSession());
  if (!ctx) redirect("/login");
  await logView(ctx.userId, null, "/provider");
  const cases = await practiceHome(ctx);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-5 text-lg">
      <h1 className="text-3xl font-bold">Your patients with this firm</h1>
      <p className="text-neutral-700">{ctx.prevLogin ? `Changes since your last visit on ${day(ctx.prevLogin)} are marked.` : "Welcome. This is your first visit."}</p>
      {cases.length === 0 && <p className="rounded-lg border border-neutral-300 bg-white p-5">The firm has not shared any case with you yet.</p>}
      <ul className="space-y-3">
        {cases.map((c) => (
          <li key={c.matterId}>
            <a href={`/provider/case/${c.matterId}`} className="block rounded-lg border border-neutral-300 bg-white p-4 hover:border-black">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-2xl font-bold">{c.patient ?? "Patient"}</span>
                {c.status && <span>{c.status}</span>}
                {c.stage && <span className="text-neutral-700">stage: {c.stage}</span>}
                <span className="ml-auto text-base text-neutral-600">updated {day(c.lastUpdate)}</span>
              </div>
              {c.openRequests !== null && <p>{c.openRequests === 0 ? "No open requests" : `${c.openRequests} open request${c.openRequests === 1 ? "" : "s"} from the firm`}</p>}
              {c.moved.length > 0 && <p className="mt-1 rounded bg-yellow-100 px-2 py-1 text-base">New: {c.moved.join("; ")}</p>}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
