// Owner: Laksh. One sign-in page, two doors: the firm through Clio, providers by email plus access code.
import { redirect } from "next/navigation";
import LoginForm from "@/components/provider/LoginForm";
import { getSession } from "@/lib/session";

export default async function Login({ searchParams }: { searchParams: Promise<{ revoked?: string }> }) {
  const s = await getSession();
  const { revoked } = await searchParams;
  // A provider whose code was revoked keeps a signed cookie; let them see the form instead of bouncing.
  if (s?.role === "firm") redirect("/firm");
  return (
    <main className="mx-auto w-full max-w-4xl p-6 text-lg text-black">
      <h1 className="mb-6 text-3xl font-bold">Casebrief</h1>
      {revoked && <p className="mb-4 rounded bg-yellow-100 p-3">Your access was turned off by the firm. Ask them for a new code.</p>}
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-neutral-300 bg-white p-5">
          <h2 className="mb-2 text-2xl font-bold">Law firm</h2>
          <p className="mb-4 text-neutral-700">Sign in with your Clio account. Casebrief only reads from Clio.</p>
          <a href="/api/clio/login" className="inline-block rounded bg-black px-5 py-2 font-semibold text-white">Sign in with Clio</a>
        </section>
        <section className="rounded-lg border border-neutral-300 bg-white p-5">
          <h2 className="mb-2 text-2xl font-bold">Medical provider</h2>
          <p className="mb-4 text-neutral-700">See what the firm has shared about your patients and answer its requests.</p>
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
