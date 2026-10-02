// Owner: Laksh. One case as this provider sees it. Each open is written to view_log for the firm.
import { notFound, redirect } from "next/navigation";
import ProviderCaseClient from "@/components/provider/ProviderCaseClient";
import { logView, providerCase, providerCtx } from "@/lib/portal/provider";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProviderCasePage({ params }: { params: Promise<{ matterId: string }> }) {
  const ctx = await providerCtx(await getSession());
  if (!ctx) redirect("/login");
  const matterId = Number((await params).matterId);
  const data = await providerCase(ctx, matterId);
  if (!data) notFound();
  await logView(ctx.userId, matterId, `/provider/case/${matterId}`);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-5 text-lg">
      <p><a href="/provider" className="underline">All patients</a></p>
      <h1 className="text-3xl font-bold">{data.patient ?? "Patient"}</h1>
      <p className="text-neutral-700">Shared by the firm. Your answers go straight to the attorney&rsquo;s file.</p>
      <ProviderCaseClient initial={data} />
    </main>
  );
}
