// Owner: Laksh. Every /provider page needs a provider session with an active access code.
import { redirect } from "next/navigation";
import SignOut from "@/components/provider/SignOut";
import { providerCtx } from "@/lib/portal/provider";
import { requireRole } from "@/lib/session";

export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const ctx = await providerCtx(await requireRole("provider"));
  if (!ctx) redirect("/login?revoked=1");
  return (
    <div className="min-h-screen bg-neutral-100 text-black">
      <header className="border-b border-neutral-300 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-5 py-3 text-lg">
          <a href="/provider" className="text-2xl font-bold">Casebrief</a>
          <span className="text-neutral-700">{ctx.name ?? ctx.email}</span>
          <span className="ml-auto"><SignOut /></span>
        </div>
      </header>
      {children}
    </div>
  );
}
