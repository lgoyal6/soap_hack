// Owner: Laksh. Provider sign-in: email plus the access code from the firm.
"use client";

import { useState } from "react";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/auth/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) window.location.href = j.next ?? "/provider";
    else setErr(j.error ?? "Sign-in failed");
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="font-semibold">Email the firm has on file for your practice</span>
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded border border-neutral-400 px-3 py-2" />
      </label>
      <label className="block">
        <span className="font-semibold">Access code from the firm</span>
        <input required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" className="mt-1 block w-full rounded border border-neutral-400 px-3 py-2 font-mono uppercase tracking-wider" />
      </label>
      {err && <p className="text-red-700">{err}</p>}
      <button disabled={busy} className="rounded bg-black px-5 py-2 font-semibold text-white disabled:opacity-60">{busy ? "Checking ..." : "Sign in"}</button>
    </form>
  );
}
