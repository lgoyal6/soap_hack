// Public, fixture-only walk-through for the Casebrief product.
// This route avoids sessions, the database, Clio, and model calls.
// The sample keeps the source-to-claim behavior visible without exposing case data.
export default function DemoPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl space-y-6 bg-neutral-100 p-6 text-black">
      <header className="rounded-2xl border border-neutral-300 bg-white p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Synthetic demo · no Clio connection</p>
        <h1 className="mt-2 text-3xl font-bold">Casebrief</h1>
        <p className="mt-2 max-w-3xl text-neutral-700">
          A case brief that links each conclusion to its source, flags conflicting records, and tracks what is still missing.
          This example is fictional and does not use a live case, account, or model.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-neutral-300 bg-white p-5 md:col-span-2">
          <h2 className="text-2xl font-semibold">Demo Client A · rear-end collision</h2>
          <p className="mt-1 text-neutral-600">Stage: treatment · Last contact: July 2, 2025</p>
          <div className="mt-5 space-y-3">
            <p className="rounded-lg bg-blue-50 p-4">The file contains two different coverage limits. The carrier letter states $100,000 per person, so the brief uses the written limit and preserves the earlier conflict.</p>
            <details className="rounded-lg border border-blue-200 p-4">
              <summary className="cursor-pointer font-semibold text-blue-900">View the supporting records</summary>
              <blockquote className="mt-3 border-l-4 border-neutral-400 pl-3 text-neutral-700">Intake note: “$250,000 policy.” <span className="text-sm">Synthetic record 101</span></blockquote>
              <blockquote className="mt-3 border-l-4 border-blue-700 pl-3 text-neutral-700">Carrier letter: “$100,000 per person.” <span className="text-sm">Synthetic record 102, later written source</span></blockquote>
            </details>
          </div>
        </article>
        <aside className="rounded-2xl border border-neutral-300 bg-white p-5">
          <h2 className="text-xl font-semibold">Open item</h2>
          <p className="mt-2">Physical therapy file and itemized billing</p>
          <p className="mt-2 text-neutral-600">Requested twice. Still outstanding.</p>
          <details className="mt-3 rounded-lg border border-neutral-200 p-3">
            <summary className="cursor-pointer font-medium">See request history</summary>
            <ul className="mt-2 list-inside list-disc text-neutral-700">
              <li>First request · March 1, 2025</li>
              <li>Follow-up · April 15, 2025</li>
            </ul>
          </details>
        </aside>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-neutral-300 bg-white p-5">
          <h2 className="text-xl font-semibold">Conflicts kept visible</h2>
          <p className="mt-2 text-neutral-700">The brief does not silently reconcile the $250,000 intake note with the $100,000 carrier letter. It shows both and identifies the written source used.</p>
        </article>
        <article className="rounded-2xl border border-neutral-300 bg-white p-5">
          <h2 className="text-xl font-semibold">Still missing</h2>
          <p className="mt-2 text-neutral-700">The client mentioned dashcam footage, but it has not arrived. Casebrief records the follow-up instead of treating the footage as present.</p>
        </article>
      </section>

      <footer className="flex flex-wrap gap-4 text-sm text-neutral-600">
        <span>All names, records, dates, and amounts here are synthetic.</span>
        <a className="font-semibold text-blue-800 underline" href="/login">Firm or provider sign-in</a>
      </footer>
    </main>
  );
}
