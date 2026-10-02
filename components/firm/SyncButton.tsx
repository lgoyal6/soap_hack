// Owner: Tijil. First-run button: read the case from Clio, then build the brief.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  async function run() {
    setBusy("Reading from Clio ...");
    const r = await fetch("/api/sync", { method: "POST" });
    if (!r.ok) { setBusy(`Could not read from Clio: ${(await r.json()).error ?? r.status}`); return; }
    setBusy("Building the brief ...");
    await fetch("/api/case/process", { method: "POST" });
    router.refresh();
  }
  return <button onClick={run} disabled={busy.endsWith("...")} className="rounded bg-black px-4 py-2 font-semibold text-white">{busy || "Read the case from Clio"}</button>;
}
